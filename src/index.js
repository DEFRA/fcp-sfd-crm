import process from 'node:process'
import { createLogger } from './logging/logger.js'
import { startServer } from './api/common/helpers/start-server.js'
import { startMessaging } from './messaging/inbound/index.js'
import { setCorrelationIdIndex } from './repos/cases.js'

const logger = createLogger()

try {
  await startServer()
} catch {
  // startServer has already logged the reason. Exit now rather than carry on
  // without a server or database, which would only fail later with a
  // misleading error.
  process.exit(1)
}

logger.info('HTTP server started')

await setCorrelationIdIndex()

// Messaging is stopped by hapi-pulse's preServerStop hook on shutdown.
startMessaging()

process.on('unhandledRejection', (error) => {
  logger.info('Unhandled rejection')
  logger.error(error)
  process.exitCode = 1
})
