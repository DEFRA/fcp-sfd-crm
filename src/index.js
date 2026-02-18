import process from 'node:process'
import { createLogger } from './logging/logger.js'
import { startServer } from './api/common/helpers/start-server.js'
import { startMessaging, stopMessaging } from './messaging/inbound/index.js'
import { setCorrelationIdIndex } from './repos/cases.js'

const logger = createLogger()

const server = await startServer()

logger.info('HTTP server started')

await setCorrelationIdIndex()

startMessaging()

server.events.on('stop', () => {
  stopMessaging()
})

process.on('unhandledRejection', (error) => {
  logger.info('Unhandled rejection')
  logger.error(error)
  process.exitCode = 1
})
