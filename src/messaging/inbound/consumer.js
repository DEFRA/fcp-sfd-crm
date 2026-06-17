import { Consumer } from 'sqs-consumer'
import { SendMessageCommand } from '@aws-sdk/client-sqs'

import { createLogger } from '../../logging/logger.js'
import { config } from '../../config/index.js'
import { createCase } from '../../services/case.js'
import { inboundCloudEventSchema, validationOptions } from '../../api/schemas/index.js'
import { logInboundValidationFailure } from '../../utils/validation-logger.js'

// Allow injection of logger for testing
let logger = createLogger()
const setLogger = (customLogger) => {
  logger = customLogger
}

const sendToDlq = async (sqsClient, dlqUrl, message, logContext) => {
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
      error: logContext
    }, 'Message sent to DLQ')
  } catch (dlqErr) {
    logger.error({
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

const processValidatedMessage = async (sqsClient, dlqUrl, payload, message) => {
  try {
    await createCase(payload)
    return message
  } catch (err) {
    if (err.retryable) {
      logger.info({
        event: {
          type: 'crm_case_creation_retryable',
          action: 'leave_on_queue',
          category: 'messaging',
          outcome: 'unknown',
          reason: err.message
        },
        retry: err.retryMetadata ?? null
      }, 'Retryable error, leaving message on queue')
      return undefined
    }

    const fileId = payload?.data?.file?.fileId ?? null
    await sendToDlq(sqsClient, dlqUrl, message, {
      errorClassification: err.retryMetadata?.category ?? 'non-retryable',
      fileId,
      status: err.retryMetadata?.status ?? null
    })
    logger.error({
      event: {
        type: 'crm_case_creation_failed',
        action: 'discard_message',
        category: 'messaging',
        outcome: 'failure',
        reason: err.message
      },
      error: {
        message: err.message,
        status: err.retryMetadata?.status ?? null,
        category: err.retryMetadata?.category ?? null
      },
      retry: err.retryMetadata ?? null
    }, 'Failed to create case via CRM API')
    return message
  }
}

const startCRMListener = (sqsClient) => {
  const queueUrl = config.get('messaging.crmRequest.queueUrl')
  const dlqUrl = config.get('messaging.crmRequest.deadLetterUrl')

  logger.info({ queueUrl, endpoint: sqsClient.config.endpoint }, 'Starting CRM request consumer')

  crmRequestConsumer = Consumer.create({
    queueUrl,
    batchSize: config.get('messaging.batchSize'),
    waitTimeSeconds: config.get('messaging.waitTimeSeconds'),
    pollingWaitTime: config.get('messaging.pollingWaitTime'),
    sqs: sqsClient,
    async handleMessage(message) {
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

      let payload
      try {
        payload = JSON.parse(message.Body)
      } catch (err) {
        await sendToDlq(sqsClient, dlqUrl, message, { errorClassification: 'invalid_json', message: err.message })
        return message
      }

      const { error } = inboundCloudEventSchema.validate(payload, validationOptions)
      if (error) {
        logInboundValidationFailure(logger, error, payload)
        await sendToDlq(sqsClient, dlqUrl, message, { errorClassification: 'schema_invalid' })
        return message
      }

      return processValidatedMessage(sqsClient, dlqUrl, payload, message)
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
