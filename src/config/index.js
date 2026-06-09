import convict from 'convict'
import convictFormatWithValidator from 'convict-format-with-validator'
import { serverConfig } from './server.js'
import { authConfig } from './auth.js'
import { crmConfig } from './crm.js'
import { queueConfig } from './queue.js'
import { awsConfig } from './aws.js'
import { messagingConfig } from './messaging.js'
import { retryConfig } from './retry.js'

convict.addFormats(convictFormatWithValidator)

const config = convict({
  ...serverConfig,
  ...authConfig,
  ...crmConfig,
  ...queueConfig,
  ...awsConfig,
  ...messagingConfig,
  ...retryConfig
})

config.validate({ allowed: 'strict' })

export { config }
