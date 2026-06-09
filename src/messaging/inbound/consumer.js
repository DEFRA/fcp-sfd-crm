import { Consumer } from 'sqs-consumer'

import { createLogger } from '../../logging/logger.js'
import { config } from '../../config/index.js'
import { createCase } from '../../services/case.js'
import { inboundCloudEventSchema, validationOptions } from '../../api/schemas/index.js'

// Allow injection of logger for testing
let logger = createLogger()
const setLogger = (customLogger) => {
  logger = customLogger
}

let crmRequestConsumer

const startCRMListener = (sqsClient) => {
  const queueUrl = config.get('messaging.crmRequest.queueUrl')

  logger.info({ queueUrl, endpoint: sqsClient.config.endpoint }, 'Starting CRM request consumer')

  crmRequestConsumer = Consumer.create({
    queueUrl,
    batchSize: config.get('messaging.batchSize'),
    waitTimeSeconds: config.get('messaging.waitTimeSeconds'),
    pollingWaitTime: config.get('messaging.pollingWaitTime'),
    sqs: sqsClient,
    async handleMessage(message) {
      let payload
      try {
        payload = JSON.parse(message.Body)
      } catch (err) {
        logger.error('Invalid JSON in inbound message', err)
        return message
      }

      const { error } = inboundCloudEventSchema.validate(payload, validationOptions)
      if (error) {
        logger.error(
          {
            validationErrors: error.details.map(d => ({
              message: d.message,
              path: d.path,
              type: d.type
            })),
            payload
          },
          'Inbound message failed validation'
        )
        return message
      }

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
        logger.error({
          event: {
            type: 'crm_case_creation_failed',
            action: 'discard_message',
            category: 'messaging',
            outcome: 'failure',
            reason: err.message
          },
          error: {
            message: err.message
          },
          retry: err.retryMetadata ?? null
        }, 'Failed to create case via CRM API')
        return message
      }
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
