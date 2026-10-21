export const dlqRoutingMetric = 'crm.dlq.routed'

export const dlqRoutingReasons = Object.freeze({
  INVALID_JSON: 'invalid_json',
  SCHEMA_INVALID: 'schema_invalid',
  CASE_CREATION_FAILED: 'case_creation_failed',
  METADATA_ATTACHMENT_FAILED: 'metadata_attachment_failed'
})
