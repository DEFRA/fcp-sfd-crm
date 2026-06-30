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

const buildEntities = (eventData) => {
  const entities = []

  if (eventData.contactId) {
    entities.push({ entity: 'person', action: 'read', entityid: String(eventData.contactId) })
  }

  if (eventData.accountId) {
    entities.push({ entity: 'business', action: 'read', entityid: String(eventData.accountId) })
  }

  if (eventData.caseId) {
    entities.push({ entity: 'document', action: 'created', entityid: String(eventData.caseId) })
  }

  if (eventData.metadataId) {
    entities.push({ entity: 'document', action: 'created', entityid: String(eventData.metadataId) })
  }

  if (entities.length === 0) {
    entities.push({ entity: 'service', action: 'event', entityid: '' })
  }

  return entities
}

const normalizeDetails = (details) => {
  if (details && typeof details !== 'object') {
    return { message: String(details) }
  }

  return details
}

const buildSecurityPayload = (eventData, correlationId) => {
  const security = { ...eventData.security }
  security.details = normalizeDetails(security.details)

  const securityPayload = { security }

  if (correlationId) {
    securityPayload.correlationid = String(correlationId)
  }

  return securityPayload
}

const buildAuditPayload = (eventData, correlationId) => {
  const audit = {
    entities: buildEntities(eventData),
    accounts: eventData.accounts && typeof eventData.accounts === 'object' ? { ...eventData.accounts } : {}
  }

  if (eventData.audit && typeof eventData.audit === 'object') {
    if (eventData.audit.status) {
      audit.status = eventData.audit.status
    }

    audit.details = normalizeDetails(eventData.audit.details)
  }

  const payload = { audit }

  if (correlationId) {
    payload.correlationid = String(correlationId)
  }

  return payload
}

export const sendAuditEvent = async (event) => {
  try {
    const eventData = event || {}
    const correlationId = eventData.correlationId || eventData.correlationid

    if (eventData.security) {
      await publishAuditEvent(buildSecurityPayload(eventData, correlationId), auditPublishConfig)
      return
    }

    await publishAuditEvent(buildAuditPayload(eventData, correlationId), auditPublishConfig)
  } catch (err) {
    logger.error(
      { event: { type: 'audit_publish_failed', outcome: 'failure', reason: err.message } },
      'Failed to publish audit event'
    )
  }
}
