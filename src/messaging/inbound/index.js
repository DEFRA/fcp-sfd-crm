import { sqsClient } from '../sqs/client.js'
import { startCRMListener, stopCRMListener } from './consumer.js'

const startMessaging = () => {
  startCRMListener(sqsClient)
}

const stopMessaging = () => {
  stopCRMListener()
}

export { startMessaging, stopMessaging }
