import { publishAuditEvent } from '@defra/fcp-audit-publisher'
import { snsClient } from '../../sns/client.js'
import { config } from '../../../config/index.js'
import { createLogger } from '../../../logging/logger.js'

const logger = createLogger()

const auditPublishConfig = {
  snsClient,
  sns: { topicArn: String(config.get('messaging.audit.topicArn') || process.env.AUDIT_TOPIC_ARN || '') },
  application: String(config.get('serviceName') || process.env.SERVICE_NAME || 'fcp-sfd-crm'),
  component: String(config.get('serviceName') || process.env.SERVICE_NAME || 'fcp-sfd-crm'),
  environment: String(config.get('cdpEnvironment') || process.env.ENVIRONMENT || 'local'),
  version: '1.0.0',
  generateCorrelationId: true,
  ip: '0.0.0.0'
}

export const sendAuditEvent = async (event) => {
  try {
    // Accept audit-domain input (not CloudEvents) and normalize to the
    // payload shape expected by the audit publisher.
    const d = event || {}
    const correlationId = d.correlationId || d.correlationid

    const out = {}

    // Map accounts if present
    if (d.accounts && typeof d.accounts === 'object') {
      out.audit = out.audit || {}
      out.audit.accounts = { ...d.accounts }
    }

    // Map correlation id (publisher will generate one if missing)
    if (correlationId) out.correlationid = String(correlationId)

    // Map entities into audit.entities with `entityid` (schema requires this)
    out.audit = out.audit || {}
    out.audit.entities = out.audit.entities || []

    if (d.contactId) {
      out.audit.entities.push({ entity: 'person', action: 'read', entityid: String(d.contactId) })
    }

    if (d.accountId) {
      out.audit.entities.push({ entity: 'business', action: 'read', entityid: String(d.accountId) })
    }

    if (d.caseId) {
      out.audit.entities.push({ entity: 'document', action: 'created', entityid: String(d.caseId) })
    }

    if (d.metadataId) {
      out.audit.entities.push({ entity: 'document', action: 'created', entityid: String(d.metadataId) })
    }

    // If caller provided an audit.status or audit.details, copy them
    if (d.audit && typeof d.audit === 'object') {
      if (d.audit.status) out.audit.status = d.audit.status
      if (d.audit.details) out.audit.details = d.audit.details
    }

    // Ensure at least one entity exists
    if (!out.audit.entities || out.audit.entities.length === 0) {
      out.audit.entities = [{ entity: 'service', action: 'event', entityid: '' }]
    }

    // If a security object was provided, send a security payload
    if (d.security) {
      const sec = { ...d.security }
      if (sec.details && typeof sec.details !== 'object') sec.details = { message: String(sec.details) }
      const payload = { security: sec }
      if (correlationId) payload.correlationid = String(correlationId)
      await publishAuditEvent(payload, auditPublishConfig)
      return
    }

    // Ensure details is an object (schema requires object)
    if (out.audit.details && typeof out.audit.details !== 'object') out.audit.details = { message: String(out.audit.details) }
    // Ensure accounts is an object
    out.audit.accounts = out.audit.accounts || {}

    const payload = { audit: out.audit }
    if (correlationId) payload.correlationid = String(correlationId)

    await publishAuditEvent(payload, auditPublishConfig)
  } catch (err) {
    logger.error(
      { event: { type: 'audit_publish_failed', outcome: 'failure', reason: err.message } },
      'Failed to publish audit event'
    )
  }
}
