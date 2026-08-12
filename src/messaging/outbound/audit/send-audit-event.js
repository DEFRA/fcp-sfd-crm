import { publishAuditEvent } from '@defra/fcp-audit-publisher'
import { snsClient } from '../../sns/client.js'
import { config } from '../../../config/index.js'
import { createLogger } from '../../../logging/logger.js'
import { auditLogEventType, auditLogReasons } from '../../../constants/audit.js'

const logger = createLogger()

const auditPublishConfig = {
  snsClient,
  sns: { topicArn: config.get('messaging.audit.topicArn') },
  application: config.get('serviceName'),
  component: config.get('serviceName'),
  environment: config.get('cdpEnvironment'),
  version: '1.0.0',
  generateCorrelationId: true,
  ip: '0.0.0.0'
}

// publishAuditEvent validates the config and the event, in that order, before
// it ever calls SNS. Both validation failures throw a message with this
// prefix, so anything else must be a transport (SNS) failure.
const isSchemaValidationError = (err) =>
  typeof err?.message === 'string' && (err.message.startsWith('Invalid audit event') || err.message.startsWith('Invalid config'))

/**
 * Publish an audit event via the shared fcp-audit-publisher module.
 *
 * Failures are caught and logged, never thrown, so that a failure to audit
 * never affects message processing outcome (acknowledgement, redelivery or
 * DLQ routing). Only a classification of the failure is logged — never the
 * event payload, auth tokens or CRM API responses, which may contain PII.
 * @param {object} event - audit event payload, see build-audit-event.js
 * @returns {Promise<void>}
 */
export const sendAuditEvent = async (event) => {
  try {
    await publishAuditEvent(event, auditPublishConfig)
  } catch (err) {
    logger.error(
      {
        event: {
          type: auditLogEventType,
          action: 'publish_audit_event',
          category: 'process',
          outcome: 'failure',
          reason: isSchemaValidationError(err) ? auditLogReasons.SCHEMA_VALIDATION : auditLogReasons.TRANSPORT,
          reference: event?.correlationid ?? null
        }
      },
      'Failed to publish audit event'
    )
  }
}
