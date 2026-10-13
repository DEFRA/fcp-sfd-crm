export const messagingEventTypes = {
  CASE_CREATION_RETRYABLE: 'crm_case_creation_retryable',
  CASE_CREATION_FAILED: 'crm_case_creation_failed',
  METADATA_ATTACHMENT_FAILED: 'crm_metadata_attachment_failed',
  SNS_PUBLISH_FAILED: 'crm.events.publish_failed',
  DLQ_SEND_FAILED: 'crm.events.dlq_send_failed'
}

export const messagingActions = {
  LEAVE_ON_QUEUE: 'leave_on_queue',
  DISCARD_MESSAGE: 'discard_message',
  PUBLISH: 'publish',
  SEND_TO_DLQ: 'send_to_dlq'
}

export const messagingCategories = {
  MESSAGING: 'messaging'
}

export const messagingOutcomes = {
  FAILURE: 'failure',
  UNKNOWN: 'unknown'
}

export const messagingLogMessages = {
  RETRYABLE_ERROR: 'Retryable error, leaving message on queue',
  ATTACH_METADATA_FOR_ADDITIONAL_FILE: 'Failed to attach metadata for additional file',
  CREATE_CASE_VIA_CRM_API: 'Failed to create case via CRM API'
}

export const messagingErrorClassifications = {
  NON_RETRYABLE: 'non-retryable',
  RETRYABLE: 'retryable',
  INVALID_JSON: 'invalid_json',
  SCHEMA_INVALID: 'schema_invalid'
}
