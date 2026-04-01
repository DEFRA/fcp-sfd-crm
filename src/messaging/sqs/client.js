import environments from '../../constants/environments.js'

import { SQSClient } from '@aws-sdk/client-sqs'

import { config } from '../../config/index.js'

const sqsConfig = {
  endpoint: config.get('aws.sqsEndpoint'),
  region: config.get('aws.region')
}

if (config.get('env') !== environments.PRODUCTION) {
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
