import { SNSClient } from '@aws-sdk/client-sns'
import environments from '../../constants/environments.js'
import { config } from '../../config/index.js'

// Use convict-backed configuration for AWS values so env var mappings are respected
const currentEnv = config.get('env')

const isProduction = currentEnv === environments.PRODUCTION
const snsConfig = {
  endpoint: config.get('aws.snsEndpoint'),
  region: config.get('aws.region'),
  // Bound the publish so a degraded SNS endpoint cannot extend SQS message
  // processing past the queue's visibility timeout and cause redelivery.
  requestHandler: {
    requestTimeout: config.get('aws.snsRequestTimeoutMs'),
    connectionTimeout: config.get('aws.snsRequestTimeoutMs')
  },
  maxAttempts: config.get('aws.snsMaxAttempts'),
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
