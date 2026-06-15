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
    },
    crmEvents: {
      topicArn: {
        doc: 'ARN (Amazon Resource Name) for the CRM events SNS topic to publish CRM requests to the Farming Data Model (FDM)',
        format: String,
        default: null,
        env: 'CRM_EVENTS_TOPIC_ARN'
      },
      publishDlqUrl: {
        doc: 'URL for the outbound SNS publish dead letter queue',
        format: String,
        default: null,
        env: 'CRM_EVENTS_PUBLISH_DLQ_URL'
      },
      publishRetry: {
        maxAttempts: {
          doc: 'Maximum SNS publish attempts before routing to DLQ',
          format: Number,
          default: 3,
          env: 'CRM_EVENTS_PUBLISH_RETRY_MAX_ATTEMPTS'
        },
        baseDelayMs: {
          doc: 'Base delay in ms for SNS publish retry exponential backoff',
          format: Number,
          default: 500,
          env: 'CRM_EVENTS_PUBLISH_RETRY_BASE_DELAY_MS'
        },
        backoffMultiplier: {
          doc: 'Backoff multiplier for SNS publish retries',
          format: Number,
          default: 2,
          env: 'CRM_EVENTS_PUBLISH_RETRY_BACKOFF_MULTIPLIER'
        },
        jitterPercentage: {
          doc: 'Jitter percentage applied to SNS publish retry delays',
          format: Number,
          default: 20,
          env: 'CRM_EVENTS_PUBLISH_RETRY_JITTER_PERCENTAGE'
        }
      }
    }
  }
}
