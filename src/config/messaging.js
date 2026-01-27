export const messagingConfig = {
  messaging: {
    crmEvents: {
      topicArn: {
        doc: 'ARN (Amazon Resource Name) for the CRM events SNS topic to publish CRM requests to the Farming Data Model (FDM)',
        format: String,
        default: null,
        env: 'CRM_EVENTS_TOPIC_ARN'
      }
    }
  }
}
