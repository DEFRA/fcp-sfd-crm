import environments from '../../constants/environments.js'

import { SNSClient } from '@aws-sdk/client-sns'

import { config } from '../../config/index.js'

const snsConfig = {
  endpoint: config.get('aws.snsEndpoint'),
  region: config.get('aws.region')
}

if (config.get('env') !== environments.PRODUCTION) {
  snsConfig.credentials = {
    accessKeyId: config.get('aws.accessKeyId'),
    secretAccessKey: config.get('aws.secretAccessKey')
  }
}

const snsClient = new SNSClient(snsConfig)

export { snsClient }
