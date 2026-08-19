import { Consumer } from 'sqs-consumer'
import { SendMessageCommand } from '@aws-sdk/client-sqs'

import { createLogger } from '../../logging/logger.js'
import { config } from '../../config/index.js'
import { createCase } from '../../services/case.js'
import { inboundCloudEventSchema, validationOptions } from '../../api/schemas/index.js'
import { logInboundValidationFailure } from '../../utils/validation-logger.js'
import { runWithCorrelationId } from '../../logging/correlation-id-store.js'
import { messages } from '../../constants/messages.js'
import {
  messagingEventTypes,
  messagingActions,
  messagingCategories,
  messagingOutcomes,
  messagingLogMessages,
  messagingErrorClassifications
} from '../../constants/messaging-events.js'

// Allow injection of logger for testing
let logger = createLogger()
const setLogger = (customLogger) => {
  logger = customLogger
}

// CDP only indexes a fixed subset of ECS fields, so any additional context is
// carried in tenant.message rather than emitted as bespoke top-level keys.
const toTenantMessage = (context) => {
  const entries = Object.entries(context).filter(([, value]) => value !== null && value !== undefined)
  return entries.length ? entries.map(([key, value]) => `${key}=${value}`).join(' ') : null
}

const sendToDlq = async (sqsClient, dlqUrl, message, { error, tenant } = {}) => {
  try {
    await sqsClient.send(new SendMessageCommand({
      QueueUrl: dlqUrl,
      MessageBody: message.Body
    }))
    logger.error({
      event: {
        type: 'crm.dlq.message_received',
        action: 'send_to_dlq',
        category: 'messaging',
        outcome: 'failure',
        reference: message.MessageId
      },
      error,
      tenant
    }, 'Message routed to DLQ')
  } catch (dlqErr) {
    logger.fatal({
      event: {
        type: 'crm.dlq.send_failed',
        action: 'send_to_dlq',
        category: 'messaging',
        outcome: 'failure',
        reference: message.MessageId
      },
      error: { message: dlqErr.message }
    }, 'Failed to send message to DLQ — message will be deleted from main queue')
  }
}

let crmRequestConsumer

const getRetryDetails = (err) => ({
  status: err.retryMetadata?.status ?? null,
  category: err.retryMetadata?.category ?? null,
  attempts: err.retryMetadata?.attempts ?? null
})

const logRetryableFailure = (err) => {
  const { status, category, attempts } = getRetryDetails(err)
  logger.info({
    event: {
      type: messagingEventTypes.CASE_CREATION_RETRYABLE,
      action: messagingActions.LEAVE_ON_QUEUE,
      category: messagingCategories.MESSAGING,
      outcome: messagingOutcomes.UNKNOWN,
      reason: err.message
    },
    error: {
      message: err.message,
      code: status,
      type: category ?? messagingErrorClassifications.RETRYABLE
    },
    tenant: {
      message: toTenantMessage({ attempts, cause: err.cause?.message })
    }
  }, messagingLogMessages.RETRYABLE_ERROR)
}

const discardFailedMessage = async (sqsClient, dlqUrl, payload, message, err) => {
  const { status, category, attempts } = getRetryDetails(err)

  const fileId = payload?.data?.file?.fileId ?? null
  const isMetadataFailure = err.message === messages.METADATA_FAILURE
  const errorType = isMetadataFailure
    ? messagingEventTypes.METADATA_ATTACHMENT_FAILED
    : messagingEventTypes.CASE_CREATION_FAILED
  const errorMsg = isMetadataFailure
    ? messagingLogMessages.ATTACH_METADATA_FOR_ADDITIONAL_FILE
    : messagingLogMessages.CREATE_CASE_VIA_CRM_API

  const errorContext = {
    message: err.message,
    code: status,
    type: category ?? messagingErrorClassifications.NON_RETRYABLE,
    stack_trace: err.stack ?? null
  }
  const tenantContext = toTenantMessage({ fileId, attempts, cause: err.cause?.message })

  await sendToDlq(sqsClient, dlqUrl, message, {
    error: errorContext,
    tenant: { message: tenantContext }
  })

  logger.error({
    event: {
      type: errorType,
      action: messagingActions.DISCARD_MESSAGE,
      category: messagingCategories.MESSAGING,
      outcome: messagingOutcomes.FAILURE,
      reason: err.message,
      reference: fileId
    },
    error: errorContext,
    tenant: {
      message: tenantContext
    }
  }, errorMsg)
}

const processValidatedMessage = async (sqsClient, dlqUrl, payload, message) => {
  try {
    await createCase(payload)
    return message
  } catch (err) {
    if (err.retryable) {
      logRetryableFailure(err)
      return undefined
    }

    await discardFailedMessage(sqsClient, dlqUrl, payload, message, err)
    return message
  }
}

const startCRMListener = (sqsClient) => {
  const queueUrl = config.get('messaging.crmRequest.queueUrl')
  const dlqUrl = config.get('messaging.crmRequest.deadLetterUrl')

  logger.info({
    tenant: {
      message: toTenantMessage({ queueUrl, endpoint: sqsClient.config.endpoint })
    }
  }, 'Starting CRM request consumer')

  crmRequestConsumer = Consumer.create({
    queueUrl,
    batchSize: config.get('messaging.batchSize'),
    waitTimeSeconds: config.get('messaging.waitTimeSeconds'),
    pollingWaitTime: config.get('messaging.pollingWaitTime'),
    sqs: sqsClient,
    async handleMessage (message) {
      let payload
      try {
        payload = JSON.parse(message.Body)
      } catch (err) {
        return runWithCorrelationId(message.MessageId, async () => {
          await sendToDlq(sqsClient, dlqUrl, message, {
            error: {
              message: err.message,
              type: messagingErrorClassifications.INVALID_JSON
            }
          })
          return message
        })
      }

      return runWithCorrelationId(payload?.data?.correlationId ?? message.MessageId, async () => {
        if (message.MessageAttributes?.replayed_from?.StringValue === 'DLQ') {
          logger.info({
            event: {
              type: 'crm.dlq.message_replayed',
              action: 'process_replayed_message',
              category: 'messaging',
              outcome: 'unknown',
              reference: message.MessageId,
              reason: 'recovery_attempt'
            }
          }, 'Processing replayed DLQ message')
        }

        const { error } = inboundCloudEventSchema.validate(payload, validationOptions)
        if (error) {
          logInboundValidationFailure(logger, error, payload)
          await sendToDlq(sqsClient, dlqUrl, message, {
            error: {
              message: error.message,
              type: messagingErrorClassifications.SCHEMA_INVALID
            }
          })
          return message
        }

        return processValidatedMessage(sqsClient, dlqUrl, payload, message)
      })
    }
  })

  crmRequestConsumer.on('started', () => {
    logger.info('CRM request consumer started')
  })

  crmRequestConsumer.on('stopped', () => {
    logger.info('CRM request consumer stopped')
  })

  crmRequestConsumer.on('error', (error) => {
    logger.error(error, 'Unhandled SQS error in CRM request consumer')
  })

  crmRequestConsumer.on('processing_error', (error) => {
    logger.error(error, 'Unhandled error during CRM request message processing')
  })

  crmRequestConsumer.on('timeout_error', (error) => {
    logger.error(error, 'CRM request processing has reached configured timeout')
  })

  crmRequestConsumer.start()
}

const stopCRMListener = () => {
  crmRequestConsumer.stop()
}

export { startCRMListener, stopCRMListener, setLogger }
