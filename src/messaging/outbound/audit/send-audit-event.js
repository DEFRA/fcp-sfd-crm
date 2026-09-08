import crypto from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { publishAuditEvent, validateAuditEvent } from '@defra/fcp-audit-publisher'
import { snsClient } from '../../sns/client.js'
import { config } from '../../../config/index.js'
import { createLogger } from '../../../logging/logger.js'
import { auditLogEventType, auditLogReasons, serviceIpLogEventType } from '../../../constants/audit.js'

const logger = createLogger()

// `application` names the programme rather than the service, so that audit
// events from every Single Front Door service can be grouped together in the
// audit store. `component` stays as the service name, which is what tells the
// individual services apart. See src/config/messaging.js for the value itself.
const auditPublishConfig = {
  snsClient,
  sns: { topicArn: config.get('messaging.audit.topicArn') },
  application: config.get('messaging.audit.application'),
  component: config.get('serviceName'),
  environment: config.get('cdpEnvironment'),
  version: '1.0.0',
  generateCorrelationId: true
}

/**
 * Resolves and caches this service's own non-internal IPv4 address, used as
 * the audit `ip`. Every audit event here is raised while consuming an SQS
 * message, so there is no inbound HTTP request to attribute and no client IP
 * to record. Falls back to `127.0.0.1` if no external interface is found, so
 * the mandatory `ip` field is always populated.
 *
 * This mirrors `getServiceIp` in fcp-sfd-object-processor, so both services
 * record the same kind of address. That service also derives an IP from an
 * inbound Hapi request where it has one; this service never has one, so that
 * part is deliberately not carried over.
 * @returns {string}
 */
let cachedServiceIp = null
export const getServiceIp = () => {
  if (cachedServiceIp) {
    return cachedServiceIp
  }
  try {
    const addresses = Object.values(networkInterfaces()).flatMap((addrs) => addrs ?? [])
    const external = addresses.find((addr) => addr.family === 'IPv4' && !addr.internal)
    if (external) {
      cachedServiceIp = external.address
      return cachedServiceIp
    }
  } catch (err) {
    // Only the error class is logged, in keeping with the rest of this module.
    logger.warn(
      {
        event: {
          type: 'error',
          action: serviceIpLogEventType,
          category: 'process',
          outcome: 'failure'
        },
        error: { type: err?.name ?? 'UnknownError' }
      },
      'Failed to resolve service IP from network interfaces, falling back to loopback'
    )
  }
  cachedServiceIp = '127.0.0.1'
  return cachedServiceIp
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
  ...(auditPublishConfig.application && { application: auditPublishConfig.application }),
  ...(auditPublishConfig.component && { component: auditPublishConfig.component }),
  ...(auditPublishConfig.environment && { environment: auditPublishConfig.environment }),
  ip: getServiceIp(),
  ...event
})

// validateAuditEvent returns joi message strings. Some joi rules interpolate
// the offending value into the message (string.pattern.base, for one), so a
// future schema revision could start echoing a CRN or SBI into the logs with
// no change here. Only the field label is retained, which classifies the
// failure without any chance of a value reaching the log.
const FIELD_LABEL_PATTERN = /^"([^"]+)"/

const validationFields = (errors = []) => [
  ...new Set(errors.map(message => FIELD_LABEL_PATTERN.exec(String(message))?.[1] ?? 'unknown'))
]

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
    logPublishFailure(auditLogReasons.SCHEMA_VALIDATION, event?.correlationid, {
      audit: { validation: { fields: validationFields(errors) } }
    })
    return
  }

  try {
    await publishAuditEvent(event, { ...auditPublishConfig, ip: getServiceIp() })
  } catch (err) {
    // Only the error class is logged. err.message here would contain the
    // topic ARN on a config failure, and could carry CRM or payload
    // fragments on others.
    logPublishFailure(auditLogReasons.TRANSPORT, event?.correlationid, {
      error: { type: err?.name ?? 'UnknownError' }
    })
  }
}

/**
 * Defensive wrapper around sendAuditEvent for use at call sites.
 *
 * sendAuditEvent catches failures of the publish itself, but not everything
 * outside that try block can be assumed safe: validateAuditEvent is
 * third-party code called before it, and logger.error is called inside its
 * own catch. A throw from either would otherwise propagate into createCase
 * and change the message processing outcome. This wrapper is what guarantees
 * it cannot. It is the single shared implementation — do not re-implement it
 * at call sites.
 * @param {object} event - audit event payload, see build-audit-event.js
 * @returns {Promise<void>}
 */
export const emitAuditEvent = async (event) => {
  try {
    await sendAuditEvent(event)
  } catch (err) {
    try {
      logPublishFailure(auditLogReasons.UNEXPECTED, event?.correlationid, {
        error: { type: err?.name ?? 'UnknownError' }
      })
    } catch {
      // A throwing logger is the one failure that cannot be reported. It must
      // still not reach the caller, or a failure to audit would change the
      // message processing outcome.
    }
  }
}
