import { sqsClient } from '../sqs/client.js'
import { startCRMListener, stopCRMListener } from './consumer.js'
import { pollInboundMessages } from './pollInboundMessages.js'
const startMessaging = () => {
  startCRMListener(sqsClient)
}

const stopMessaging = () => {
  stopCRMListener()
}

export { startMessaging, stopMessaging, pollInboundMessages }
