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
    pollingCompleteWaitTimeMs: {
      doc: 'How long (in milliseconds) shutdown waits for in-flight messages to finish before MongoDB is closed. Keep it below the platform stop timeout',
      format: Number,
      default: 20000,
      env: 'SQS_CONSUMER_POLLING_COMPLETE_WAIT_TIME_MS'
    },
    crmRequest: {
      queueUrl: {
        doc: 'URL for the CRM ingest queue',
        format: String,
        default: null,
        env: 'CRM_QUEUE_URL'
      },
      // Not nullable: without it a terminal failure has nowhere to go, and the
      // gap would only surface when the first message is dead-lettered. Leaving
      // `nullable` unset makes convict reject the null default, and the `url`
      // format rejects an empty value, so an unset or blank CRM_REQUEST_DLQ_URL
      // stops the service at startup instead.
      deadLetterUrl: {
        doc: 'URL for the CRM ingest dead letter queue (fcp_sfd_crm_requests-deadletter)',
        format: 'url',
        default: null,
        env: 'CRM_REQUEST_DLQ_URL'
      }
    },
    crmEvents: {
      topicArn: {
        doc: 'ARN (Amazon Resource Name) for the CRM events SNS topic to publish CRM requests to the Farming Data Model (FDM)',
        format: String,
        default: null,
        env: 'CRM_EVENTS_TOPIC_ARN'
      },
      // Not nullable: without it a failed publish cannot be captured for replay,
      // and the gap would only surface on the first failed publish. Leaving
      // `nullable` unset makes convict reject the null default, and the `url`
      // format rejects an empty value, so an unset or blank CRM_EVENTS_DLQ_URL
      // stops the service at startup instead.
      publishDlqUrl: {
        doc: 'URL for the outbound SNS publish dead letter queue (fcp_sfd_crm_events_publish_failures)',
        format: 'url',
        default: null,
        env: 'CRM_EVENTS_DLQ_URL'
      }
    },
    audit: {
      // Not nullable: an unset ARN would be rejected by the publisher's own
      // config schema on every single event, silently discarding the entire
      // audit stream. Leaving `nullable` unset makes convict reject the null
      // default, so the misconfiguration fails at startup instead and cannot
      // be mistaken for transport noise.
      topicArn: {
        doc: 'ARN for the audit SNS topic',
        format: String,
        default: null,
        env: 'AUDIT_TOPIC_ARN'
      },
      // Shared with fcp-sfd-object-processor, and with any other Single Front
      // Door service that publishes audit events. The audit store groups events
      // by this value, so every SFD service must send exactly the same string.
      // The default is held here rather than in cdp-app-config so there is one
      // definition per service and nothing to drift between environments. If the
      // programme is renamed, set AUDIT_APPLICATION in every SFD service's
      // defaults.env in cdp-app-config and redeploy, no code release needed.
      // Nothing validates this value: a mismatch is accepted and simply fails to
      // group, so it is not a value to vary casually.
      application: {
        doc: 'Programme name published as the audit `application`, shared across all Single Front Door services',
        format: String,
        default: 'Single Front Door',
        env: 'AUDIT_APPLICATION'
      }
    }
  }
}
