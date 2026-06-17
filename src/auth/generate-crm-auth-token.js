import { config } from '../config/index.js'
import { authHttpClient } from '../http/client.js'
import { snsClient } from '../messaging/sns/client.js'
import { publish } from '../messaging/sns/publish.js'
import { buildReceivedEvent } from '../messaging/outbound/received-event/build-received-event.js'

const CRM_EVENTS_TOPIC_KEY = 'messaging.crmEvents.topicArn'

const generateCrmAuthToken = async () => {
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
      const event = buildReceivedEvent({ data: { security: { action: 'crm.token.request', status: 'failure', message: err.message, clientId }, audit: { status: 'failure', details: 'Unable to reach token endpoint' } } }, 'uk.gov.fcp.sfd.security.auth')
      const snsTopic = config.get(CRM_EVENTS_TOPIC_KEY)
      Promise.resolve(publish(snsClient, snsTopic, event)).catch(() => { })
    } catch (e) {
      // swallow publish/build errors
    }

    throw new Error(`Unable to reach token endpoint: ${err.message}`)
  }

  if (!response.ok) {
    const errorText = await response.text()
    // Emit security/audit event for auth failure
    try {
      const event = buildReceivedEvent({ data: { security: { action: 'crm.token.request', status: 'failure', httpStatus: response.status, message: errorText, clientId }, audit: { status: 'failure', details: 'Invalid credentials' } } }, 'uk.gov.fcp.sfd.security.auth')
      const snsTopic = config.get(CRM_EVENTS_TOPIC_KEY)
      Promise.resolve(publish(snsClient, snsTopic, event)).catch(() => { })
    } catch (e) {
      // swallow publish/build errors
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
