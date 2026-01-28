export const awsConfig = {
  aws: {
    sqsEndpoint: {
      doc: 'AWS SQS (Simple Queue Service) Endpoint',
      format: String,
      default: 'https://sqs.eu-west-2.amazonaws.com',
      env: 'AWS_SQS_ENDPOINT'
    },
    snsEndpoint: {
      doc: 'AWS SNS (Simple Notification Service) Endpoint',
      format: String,
      default: 'https://sns.eu-west-2.amazonaws.com',
      env: 'AWS_SNS_ENDPOINT'
    },
    region: {
      doc: 'AWS Region',
      format: String,
      default: 'eu-west-2',
      env: 'AWS_REGION'
    },
    accessKeyId: {
      doc: 'AWS Access Key ID',
      format: String,
      default: null,
      nullable: true,
      env: 'AWS_ACCESS_KEY_ID'
    },
    secretAccessKey: {
      doc: 'AWS Secret Access Key',
      format: String,
      default: null,
      nullable: true,
      env: 'AWS_SECRET_ACCESS_KEY'
    }
  }
}
