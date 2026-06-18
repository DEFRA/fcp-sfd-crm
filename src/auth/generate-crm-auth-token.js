import { config } from '../config/index.js'
import { authHttpClient } from '../http/client.js'
import { snsClient } from '../messaging/sns/client.js'
import { publish } from '../messaging/sns/publish.js'
import { buildReceivedEvent } from '../messaging/outbound/received-event/build-received-event.js'

const CRM_EVENTS_TOPIC_KEY = 'messaging.crmEvents.topicArn'
const SECURITY_AUTH_EVENT = 'uk.gov.fcp.sfd.security.auth'
const SECURITY_AUTH_LOG = 'security.auth'

const generateCrmAuthToken = async () => {
  const { createLogger } = await import('../logging/logger.js')
  const logger = createLogger()
  const { tokenEndpoint, clientId, clientSecret, scope } = config.get('auth')

  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'client_credentials',
    scope
  })

  let response

  try {
    response = await authHttpClient(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    })
  } catch (err) {
    // Emit security/audit event for network/auth failures
    try {
      const event = buildReceivedEvent({ data: { security: { action: 'crm.token.request', status: 'failure', message: err.message, clientId }, audit: { status: 'failure', details: 'Unable to reach token endpoint' } } }, SECURITY_AUTH_EVENT)
      const snsTopic = config.get(CRM_EVENTS_TOPIC_KEY)
      Promise.resolve(publish(snsClient, snsTopic, event)).catch((pubErr) => {
        try {
          logger.error({ err: pubErr, clientId }, `Error publishing ${SECURITY_AUTH_LOG} event`)
        } catch (logErr) {
          // eslint-disable-next-line no-console
          console.error(`Failed to log ${SECURITY_AUTH_LOG} publish error`, logErr)
        }
      })
    } catch (e) {
      // Log publish/build errors for observability
      try {
        logger.error({ err: e, clientId }, `Failed to build or publish ${SECURITY_AUTH_LOG} event`)
      } catch (logErr) {
        // As a last resort, write to stderr so the exception isn't silently swallowed
        // (keeps Sonar happy about handling exceptions)
        // eslint-disable-next-line no-console
        console.error(`Failed to log ${SECURITY_AUTH_LOG} publish error`, logErr)
      }
    }

    throw new Error(`Unable to reach token endpoint: ${err.message}`)
  }

  if (!response.ok) {
    const errorText = await response.text()
    // Emit security/audit event for auth failure
    try {
      const event = buildReceivedEvent({ data: { security: { action: 'crm.token.request', status: 'failure', httpStatus: response.status, message: errorText, clientId }, audit: { status: 'failure', details: 'Invalid credentials' } } }, SECURITY_AUTH_EVENT)
      const snsTopic = config.get(CRM_EVENTS_TOPIC_KEY)
      Promise.resolve(publish(snsClient, snsTopic, event)).catch((pubErr) => {
        try {
          logger.error({ err: pubErr, clientId, httpStatus: response.status }, `Error publishing ${SECURITY_AUTH_LOG} event`)
        } catch (logErr) {
          // eslint-disable-next-line no-console
          console.error(`Failed to log ${SECURITY_AUTH_LOG} publish error`, logErr)
        }
      })
    } catch (e) {
      // Log publish/build errors for observability
      try {
        logger.error({ err: e, clientId, httpStatus: response.status }, `Failed to build or publish ${SECURITY_AUTH_LOG} event`)
      } catch (logErr) {
        // As a last resort, write to stderr so the exception isn't silently swallowed
        // (keeps Sonar happy about handling exceptions)
        // eslint-disable-next-line no-console
        console.error(`Failed to log ${SECURITY_AUTH_LOG} publish error`, logErr)
      }
    }

    throw new Error(`Auth failed: ${response.status} ${response.statusText} - ${errorText}`)
  }

  const payload = await response.json()

  return {
    token: `${payload.token_type} ${payload.access_token}`,
    expiresAt: payload.expires_in
  }
}

export {
  generateCrmAuthToken
}
