import { createCase } from '../../services/caseService.js'
import { createLogger } from '../../logging/logger.js'

const logger = createLogger()

export async function handleMessage (message) {
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
