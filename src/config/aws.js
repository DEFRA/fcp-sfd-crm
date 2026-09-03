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
    },
    // SNS publishing happens inside the SQS handleMessage callback, so an
    // unbounded publish extends message processing time and can push it past
    // the queue's visibility timeout, causing the message to be redelivered.
    // A late audit event is worth less than a timely acknowledgement, so the
    // SDK defaults are replaced with an explicit bound.
    snsRequestTimeoutMs: {
      doc: 'Socket and connection timeout (ms) for SNS requests',
      format: Number,
      default: 3000,
      env: 'AWS_SNS_REQUEST_TIMEOUT_MS'
    },
    snsMaxAttempts: {
      doc: 'Maximum number of attempts (including the first) for an SNS request',
      format: Number,
      default: 2,
      env: 'AWS_SNS_MAX_ATTEMPTS'
    }
  }
}
