import process from 'node:process'

import { createLogger } from './logging/logger.js'
import { startServer } from './api/common/helpers/start-server.js'
import { getCrmAuthToken } from './auth/get-crm-auth-token.js'

await startServer()

process.on('unhandledRejection', (error) => {
  const logger = createLogger()
  logger.info('Unhandled rejection')
  logger.error(error)
  process.exitCode = 1
})
