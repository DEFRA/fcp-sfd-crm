import crypto from 'node:crypto'
import SOURCE from '../../../constants/source.js'

export const buildReceivedEvent = (message, type) => ({
  id: crypto.randomUUID(),
  source: SOURCE,
  specversion: '1.0',
  type,
  datacontenttype: 'application/json',
  time: new Date().toISOString(),
  data: {
    ...message.data,
    correlationId: message.data?.correlationId ?? message.id
  }
})
