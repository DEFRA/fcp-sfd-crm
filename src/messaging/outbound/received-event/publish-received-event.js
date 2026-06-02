import { createLogger } from '../../../logging/logger.js'
import { config } from '../../../config/index.js'
import { snsClient } from '../../sns/client.js'
import { publish } from '../../sns/publish.js'
import { eventToTypeMap } from '../../../constants/events.js'
import { buildReceivedEvent } from './build-received-event.js'
import { receivedEventSchema, validationOptions } from '../../../api/schemas/index.js'

const snsTopic = config.get('messaging.crmEvents.topicArn')

const logger = createLogger()

export const publishReceivedEvent = async (message) => {
  const type = message.type

  if (!type) {
    logger.error('Cannot publish event, message.type is missing')
    throw new Error('CloudEvent type is required to publish CRM event')
  }

  const caseType = eventToTypeMap[type]

  if (!caseType) {
    logger.error(`Unsupported CloudEvent type: ${type}`)
    throw new Error(`Unsupported CloudEvent type: ${type}`)
  }

  const receivedRequest = buildReceivedEvent(
    {
      ...message,
      data: {
        ...message.data,
        caseType
      }
    },
    type
  )
  const { error } = receivedEventSchema.validate(receivedRequest, validationOptions)
  if (error) {
    logger.error({ details: error.details }, 'Outbound SNS event failed validation')
    throw new Error('Invalid outbound SNS event payload: ' + JSON.stringify(error.details))
  }

  try {
    await publish(snsClient, snsTopic, receivedRequest)
  } catch (err) {
    logger.error(
      { err },
      `Error publishing received CRM request event | caseId=${message.data?.caseId} correlationId=${message.data?.correlationId ?? message.id} topicArn=${snsTopic}`
    )
  }
}
