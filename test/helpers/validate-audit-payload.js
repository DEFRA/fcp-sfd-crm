import { validateAuditEvent } from '@defra/fcp-audit-publisher'

export function assertValidAuditEvent (payload) {
  const { valid, errors } = validateAuditEvent(payload)
  if (!valid) {
    throw new Error(`Invalid audit event: ${errors.join('; ')}`)
  }
}
