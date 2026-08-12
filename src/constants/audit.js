export const auditEntities = {
  PERSON: 'person',
  BUSINESS: 'business',
  DOCUMENT: 'document',
  // Used only by the row 7 security event. Not part of the spike's
  // canonical entity list — pending confirmation with the fcp-audit team
  // (see FLS1-50 decision log).
  SERVICE: 'service'
}

export const auditActions = {
  READ: 'read',
  CREATED: 'created',
  // Used only by the row 7 security event, pending fcp-audit confirmation.
  AUTHENTICATE: 'authenticate'
}

export const auditStatuses = {
  SUCCESS: 'success',
  FAILURE: 'failure'
}

export const auditFailureReasons = {
  CRN_NOT_FOUND: 'CRN not found',
  SBI_NOT_FOUND: 'SBI not found'
}

// Security event pmccodes. AUTH is a placeholder pending agreement with the
// fcp-audit team (see FLS1-50 decision log) - confirm before relying on it
// for SOC queries.
export const securityPmcCodes = {
  CREDENTIAL_FAILURE: 'AUTH'
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
