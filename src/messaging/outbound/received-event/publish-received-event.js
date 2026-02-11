import { createLogger } from '../../../logging/logger.js'
import { config } from '../../../config/index.js'
import { snsClient } from '../../sns/client.js'
import { publish } from '../../sns/publish.js'
import { buildReceivedEvent } from './build-received-event.js'
import { eventToTypeMap } from '../../../constants/events.js'

const snsTopic = config.get('messaging.crmEvents.topicArn')

const logger = createLogger()

export const publishReceivedEvent = async (message) => {
  const type = message.type

  if (!type) {
    logger.error('Cannot publish event, message.type is missing')
    throw new Error('CloudEvent type is required to publish CRM event')
  }

  const mappedCaseType = eventToTypeMap[type]

  if (!mappedCaseType) {
    logger.warn(`Unmapped CloudEvent type: ${type}. Using default: 'unknown-case-type'`)
  }

  const caseType = mappedCaseType || 'unknown-case-type'

  const normalisedMessage = {
    ...message,
    data: {
      ...message.data,
      caseType
    }
  }

  const receivedRequest = buildReceivedEvent(normalisedMessage, type)

  try {
    await publish(snsClient, snsTopic, receivedRequest)
  } catch (err) {
    logger.error(err, 'Error publishing received CRM request event')
  }
}
