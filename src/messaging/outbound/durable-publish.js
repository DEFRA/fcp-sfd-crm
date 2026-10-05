import { createLogger } from '../../logging/logger.js'
import { config } from '../../config/index.js'
import { publish } from '../sns/publish.js'
import { sqsClient } from '../sqs/client.js'
import { sendToDlq } from '../sqs/send-to-dlq.js'

const logger = createLogger()

export const publishWithDurability = async (snsClient, topicArn, payload, context) => {
  const dlqUrl = config.get('messaging.crmEvents.publishDlqUrl')

  try {
    await publish(snsClient, topicArn, payload)
  } catch (err) {
    logger.error(
      {
        err,
        event: {
          type: 'crm.events.publish_failed',
          action: 'publish',
          category: 'messaging',
          outcome: 'failure',
          reference: context?.caseId
        },
        topicArn
      },
      'SNS publish failed, routing to DLQ'
    )

    const envelope = {
      originalPayload: payload,
      metadata: {
        caseId: context?.caseId,
        correlationId: context?.correlationId,
        topicArn,
        failedAt: new Date().toISOString(),
        errorMessage: err?.message ?? 'unknown',
        errorName: err?.name ?? 'Error',
        source: 'fcp-sfd-crm'
      }
    }

    try {
      await sendToDlq(sqsClient, dlqUrl, envelope)
      logger.info(
        { event: { reference: context?.caseId } },
        'Failed SNS publish routed to DLQ'
      )
    } catch (dlqErr) {
      logger.fatal(
        {
          err: dlqErr,
          originalErr: err,
          event: {
            type: 'crm.events.dlq_send_failed',
            action: 'publish',
            category: 'messaging',
            outcome: 'failure',
            reference: context?.caseId
          }
        },
        'CRITICAL: Failed to route SNS publish failure to DLQ — event may be lost'
      )
    }
  }
}
