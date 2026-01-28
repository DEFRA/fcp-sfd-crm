export const messagingConfig = {
  messaging: {
    waitTimeSeconds: {
      doc: 'The duration (in seconds) for which the call will wait for a message to arrive in the queue before returning.',
      format: Number,
      default: 10,
      env: 'SQS_CONSUMER_WAIT_TIME_SECONDS'
    },
    batchSize: {
      doc: 'The maximum number of messages to return in each call',
      format: Number,
      default: 10,
      env: 'SQS_CONSUMER_BATCH_SIZE'
    },
    pollingWaitTime: {
      doc: 'The duration (in seconds) before sqs-consumer polls for new messages',
      format: Number,
      default: 0,
      env: 'SQS_CONSUMER_POLLING_WAIT_TIME'
    },
    crmRequest: {
      queueUrl: {
        doc: 'URL for the CRM ingest queue',
        format: String,
        default: null,
        env: 'CRM_QUEUE_URL'
      },
      deadLetterUrl: {
        doc: 'URL for the CRM ingest dead letter queue',
        format: String,
        default: null,
        env: 'CRM_DEAD_LETTER_QUEUE_URL'
      }
    }
  }
}
