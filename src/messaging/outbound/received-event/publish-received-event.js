import { createLogger } from '../../../logging/logger.js'
import { config } from '../../../config/index.js'
import { snsClient } from '../../sns/client.js'
import { publish } from '../../sns/publish.js'
import { buildReceivedEvent } from './build-received-event.js'
import { crmEvents } from '../../../constants/events.js'

const snsTopic = config.get('messaging.crmEvents.topicArn')

const logger = createLogger()

export const publishReceivedEvent = async (message) => {
  const type = crmEvents.CREATED

  const receivedRequest = buildReceivedEvent(message, type)

  try {
    await publish(snsClient, snsTopic, receivedRequest)
  } catch (err) {
    logger.error(err, 'Error publishing received CRM request event')
  }
}
