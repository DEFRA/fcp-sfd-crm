import { randomInt } from 'node:crypto'
import { createLogger } from '../../logging/logger.js'
import { config } from '../../config/index.js'
import { publish } from '../sns/publish.js'
import { sqsClient } from '../sqs/client.js'
import { sendToDlq } from '../sqs/send-to-dlq.js'

const logger = createLogger()

const RANDOM_INT_UPPER_BOUND = 1001
const RANDOM_INT_DIVISOR = 1000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export const publishWithDurability = async (snsClient, topicArn, payload, context) => {
  const maxAttempts = config.get('messaging.crmEvents.publishRetry.maxAttempts')
  const baseDelayMs = config.get('messaging.crmEvents.publishRetry.baseDelayMs')
  const backoffMultiplier = config.get('messaging.crmEvents.publishRetry.backoffMultiplier')
  const jitterPercentage = config.get('messaging.crmEvents.publishRetry.jitterPercentage')
  const dlqUrl = config.get('messaging.crmEvents.publishDlqUrl')

  let lastError

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await publish(snsClient, topicArn, payload)
      return
    } catch (err) {
      lastError = err
      logger.warn(
        { err, attempt, maxAttempts, caseId: context?.caseId, correlationId: context?.correlationId },
        `SNS publish attempt ${attempt}/${maxAttempts} failed`
      )

      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(backoffMultiplier, attempt - 1)
        const jitter = delay * (jitterPercentage / 100) * (randomInt(0, RANDOM_INT_UPPER_BOUND) / RANDOM_INT_DIVISOR)
        await sleep(delay + jitter)
      }
    }
  }

  logger.error(
    { err: lastError, caseId: context?.caseId, correlationId: context?.correlationId, topicArn },
    `SNS publish failed after ${maxAttempts} attempts, routing to DLQ`
  )

  const envelope = {
    originalPayload: payload,
    metadata: {
      caseId: context?.caseId,
      correlationId: context?.correlationId,
      topicArn,
      failedAt: new Date().toISOString(),
      errorMessage: lastError?.message ?? 'unknown',
      errorName: lastError?.name ?? 'Error',
      totalAttempts: maxAttempts,
      source: 'fcp-sfd-crm'
    }
  }

  try {
    await sendToDlq(sqsClient, dlqUrl, envelope)
    logger.info(
      { caseId: context?.caseId, correlationId: context?.correlationId },
      'Failed SNS publish routed to DLQ'
    )
  } catch (dlqErr) {
    logger.error(
      { err: dlqErr, originalErr: lastError, caseId: context?.caseId, correlationId: context?.correlationId },
      'CRITICAL: Failed to route SNS publish failure to DLQ — event may be lost'
    )
  }
}
