import convict from 'convict'
import convictFormatWithValidator from 'convict-format-with-validator'
import { serverConfig } from './server.js'
import { authConfig } from './auth.js'
import { crmConfig } from './crm.js'
import { queueConfig } from './queue.js'
import { awsConfig } from './aws.js'
import { messagingConfig } from './messaging.js'

convict.addFormats(convictFormatWithValidator)

const config = convict({
  ...serverConfig,
  ...authConfig,
  ...crmConfig,
  ...queueConfig,
  ...awsConfig,
  ...messagingConfig
})

// Skip strict validation during test runs to allow tests to mock config values
// Vitest sets the VITEST env var; also allow NODE_ENV=test
if (!process.env.VITEST && process.env.NODE_ENV !== 'test') {
  config.validate({ allowed: 'strict' })
}

export { config }
