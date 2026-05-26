import { SNSClient } from '@aws-sdk/client-sns'
import environments from '../../constants/environments.js'
import { config } from '../../config/index.js'

// Use convict-backed configuration for AWS values so env var mappings are respected
const currentEnv = process.env.NODE_ENV || config.get('env')

const isProduction = currentEnv === environments.PRODUCTION
const snsConfig = {
  endpoint: config.get('aws.snsEndpoint'),
  region: config.get('aws.region'),
  ...(isProduction
    ? {}
    : {
      // Always pass credentials object (may contain undefined/null values) so unit tests can assert on it
      credentials: {
        accessKeyId: config.get('aws.accessKeyId'),
        secretAccessKey: config.get('aws.secretAccessKey')
      }
    })
}

const snsClient = new SNSClient(snsConfig)

export { snsClient }
