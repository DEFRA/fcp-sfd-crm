import crypto from 'node:crypto'
import { publishAuditEvent, validateAuditEvent } from '@defra/fcp-audit-publisher'
import { snsClient } from '../../sns/client.js'
import { config } from '../../../config/index.js'
import { createLogger } from '../../../logging/logger.js'
import { auditLogEventType, auditLogReasons } from '../../../constants/audit.js'

const logger = createLogger()

// Message consumers have no meaningful client IP; the schema requires the
// field, so a sentinel is published in place of a real one. Agreed with the
// fcp-audit team as the approach for non-HTTP-request audit events (see
// FLS1-50 decision log).
const CONSUMER_SENTINEL_IP = '0.0.0.0'

const auditPublishConfig = {
  snsClient,
  sns: { topicArn: config.get('messaging.audit.topicArn') },
  application: config.get('serviceName'),
  component: config.get('serviceName'),
  environment: config.get('cdpEnvironment'),
  version: '1.0.0',
  generateCorrelationId: true,
  ip: CONSUMER_SENTINEL_IP
}

/**
 * Merge an event with the same defaults publishAuditEvent would apply, so it
 * can be validated structurally before a network call is attempted. Mirrors
 * `applyDefaults` in @defra/fcp-audit-publisher: `{ ...defaults, ...event }`.
 * @param {object} event
 * @returns {object}
 */
const mergeWithPublishDefaults = (event) => ({
  datetime: new Date().toISOString(),
  version: auditPublishConfig.version,
  ...(auditPublishConfig.generateCorrelationId && { correlationid: crypto.randomUUID() }),
  application: auditPublishConfig.application,
  component: auditPublishConfig.component,
  environment: auditPublishConfig.environment,
  ip: auditPublishConfig.ip,
  ...event
})

const logPublishFailure = (reason, correlationid, extra = {}) => {
  logger.error(
    {
      event: {
        type: 'error',
        action: auditLogEventType,
        category: 'process',
        outcome: 'failure',
        reason,
        ...(correlationid && { reference: correlationid })
      },
      ...extra
    },
    'Failed to publish audit event'
  )
}

/**
 * Publish an audit event via the shared fcp-audit-publisher module.
 *
 * The event is validated structurally before publishing is attempted, so a
 * malformed event never reaches SNS and the schema/transport classification
 * required by FLS1-50 is deterministic rather than inferred from a
 * third-party error message. Failures are caught and logged, never thrown,
 * so that a failure to audit never affects message processing outcome
 * (acknowledgement, redelivery or DLQ routing). Only a classification of the
 * failure is logged — never the event payload, auth tokens or CRM API
 * responses, which may contain PII.
 * @param {object} event - audit event payload, see build-audit-event.js
 * @returns {Promise<void>}
 */
export const sendAuditEvent = async (event) => {
  const { valid, errors } = validateAuditEvent(mergeWithPublishDefaults(event))

  if (!valid) {
    logPublishFailure(auditLogReasons.SCHEMA_VALIDATION, event?.correlationid, { errors })
    return
  }

  try {
    await publishAuditEvent(event, auditPublishConfig)
  } catch {
    logPublishFailure(auditLogReasons.TRANSPORT, event?.correlationid)
  }
}

/**
 * Defensive wrapper around sendAuditEvent for use at call sites.
 * sendAuditEvent already catches its own errors, but unit tests across the
 * codebase mock sendAuditEvent directly (bypassing its internal catch), so
 * this second layer guarantees a failure to audit can never propagate to a
 * caller regardless of how sendAuditEvent is invoked. This is the single
 * shared implementation — do not re-implement this wrapper at call sites.
 * @param {object} event - audit event payload, see build-audit-event.js
 * @returns {Promise<void>}
 */
export const emitAuditEvent = async (event) => {
  try {
    await sendAuditEvent(event)
  } catch {
    logPublishFailure(auditLogReasons.UNEXPECTED, event?.correlationid)
  }
}
