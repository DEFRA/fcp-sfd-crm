import { SNSClient } from '@aws-sdk/client-sns'
import environments from '../../constants/environments.js'
import { config } from '../../config/index.js'

// Prefer explicit environment variables where provided (tests set env vars directly).
// Fall back to config where necessary in runtime situations.
const currentEnv = process.env.NODE_ENV || config.get('env')

// Use explicit process.env values where tests set them; do not fall back to convict defaults
const isProduction = currentEnv === environments.PRODUCTION
const snsConfig = {
  endpoint: process.env.AWS_SNS_ENDPOINT,
  region: process.env.AWS_REGION,
  ...(isProduction
    ? {}
    : {
      // Always pass credentials object (may contain undefined values) so unit tests can assert on it
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    })
}

const snsClient = new SNSClient(snsConfig)

export { snsClient }
