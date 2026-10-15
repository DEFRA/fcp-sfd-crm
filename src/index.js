import process from 'node:process'
import { createLogger } from './logging/logger.js'
import { startServer } from './api/common/helpers/start-server.js'
import { startMessaging } from './messaging/inbound/index.js'
import { setCorrelationIdIndex } from './repos/cases.js'

const logger = createLogger()

await startServer()

logger.info('HTTP server started')

await setCorrelationIdIndex()

// Messaging is stopped by hapi-pulse's preServerStop hook on shutdown.
startMessaging()

process.on('unhandledRejection', (error) => {
  logger.info('Unhandled rejection')
  logger.error(error)
  process.exitCode = 1
})
