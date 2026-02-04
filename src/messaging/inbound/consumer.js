import { Consumer } from 'sqs-consumer'

import { createLogger } from '../../logging/logger.js'
import { config } from '../../config/index.js'
import { createCase } from '../../services/case.js'

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
    async handleMessage (message) {
      let payload
      try {
        payload = JSON.parse(message.Body)
      } catch (err) {
        logger.error('Invalid JSON in inbound message', err)
        return
      }
      try {
        await createCase(payload)
      } catch (err) {
        logger.error('Failed to create case via CRM API', err)
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
