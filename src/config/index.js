import convict from 'convict'
import convictFormatWithValidator from 'convict-format-with-validator'
import { serverConfig } from './server.js'
import { authConfig } from './auth.js'
import { crmConfig } from './crm.js'

convict.addFormats(convictFormatWithValidator)

const config = convict({
  ...serverConfig,
  ...authConfig,
  ...crmConfig
})

config.validate({ allowed: 'strict' })

export { config }
