import environments from '../../constants/environments.js'

import { SQSClient } from '@aws-sdk/client-sqs'

import { config } from '../../config/index.js'

const sqsEndpoint = config.get('aws.sqsEndpoint')
const isLocalStack = sqsEndpoint && (sqsEndpoint.includes('localhost') || sqsEndpoint.includes('localstack'))

// When running in Docker, use the service name instead of localhost
let endpoint = sqsEndpoint
if (isLocalStack && sqsEndpoint.includes('localhost')) {
  // Replace localhost with the Docker service name 'localstack'
  endpoint = sqsEndpoint.replace(/localhost(\.localstack\.cloud)?/g, 'localstack')
}

const sqsConfig = {
  endpoint,
  region: config.get('aws.region')
}

// For LocalStack, don't set credentials (it accepts requests without them)
// For non-production non-LocalStack, only set credentials if provided
if (!isLocalStack && config.get('env') !== environments.PRODUCTION) {
  const accessKeyId = config.get('aws.accessKeyId')
  const secretAccessKey = config.get('aws.secretAccessKey')

  if (accessKeyId && secretAccessKey) {
    sqsConfig.credentials = {
      accessKeyId,
      secretAccessKey
    }
  }
}

const sqsClient = new SQSClient(sqsConfig)

export { sqsClient }
