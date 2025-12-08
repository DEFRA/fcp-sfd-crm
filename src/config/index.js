import convict from 'convict'
import convictFormatWithValidator from 'convict-format-with-validator'
import { serverConfig } from './server.js'
import { authConfig } from './auth.js'

convict.addFormats(convictFormatWithValidator)

const config = convict({
  ...serverConfig,
  ...authConfig
})

config.validate({ allowed: 'strict' })

export { config }
