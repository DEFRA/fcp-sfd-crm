import { publishAuditEvent as _publishAuditEvent } from '@defra/fcp-audit-publisher'
import { snsClient } from '../../sns/client.js'
import { config } from '../../../config/index.js'
import { createLogger } from '../../../logging/logger.js'

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

export const publishAuditEvent = async (event) => {
  try {
    await _publishAuditEvent(event, auditPublishConfig)
  } catch (err) {
    logger.error(
      { event: { type: 'audit_publish_failed', outcome: 'failure', reason: err.message } },
      'Failed to publish audit event'
    )
  }
}
