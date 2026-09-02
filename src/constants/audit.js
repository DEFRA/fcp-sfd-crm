export const auditEntities = {
  PERSON: 'person',
  BUSINESS: 'business',
  DOCUMENT: 'document'
}

export const auditActions = {
  READ: 'read',
  CREATED: 'created'
}

export const auditStatuses = {
  SUCCESS: 'success',
  FAILURE: 'failure'
}

export const auditFailureReasons = {
  CRN_NOT_FOUND: 'CRN not found',
  SBI_NOT_FOUND: 'SBI not found'
}

// Structured log constants for audit publish failures (never for audit payload content)
export const auditLogEventType = 'audit_publish_failed'

export const auditLogReasons = {
  SCHEMA_VALIDATION: 'schema_validation',
  TRANSPORT: 'transport',
  // Raised only by the emitAuditEvent backstop wrapper, when sendAuditEvent
  // itself throws unexpectedly (e.g. it is mocked directly in a test and
  // bypasses its own internal catch).
  UNEXPECTED: 'unexpected'
}
