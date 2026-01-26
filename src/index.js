import process from 'node:process'
import { createLogger } from './logging/logger.js'
import { startServer } from './api/common/helpers/start-server.js'
import { pollInboundMessages } from './messaging/inbound/index.js'

const logger = createLogger()

await startServer()

logger.info('HTTP server started')

// Start inbound messaging in the background
pollInboundMessages()

process.on('unhandledRejection', (error) => {
  logger.info('Unhandled rejection')
  logger.error(error)
  process.exitCode = 1
})
