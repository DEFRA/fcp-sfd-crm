import { config } from '../config/index.js'
import { authHttpClient } from '../http/client.js'
import { sendAuditEvent } from '../messaging/outbound/audit/send-audit-event.js'
import { createLogger } from '../logging/logger.js'

const logger = createLogger()

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
    sendAuditEvent({ security: { action: 'crm.token.request', status: 'failure', message: err.message, clientId } })
    throw new Error(`Unable to reach token endpoint: ${err.message}`)
  }

  if (!response.ok) {
    const errorText = await response.text()
    sendAuditEvent({ security: { action: 'crm.token.request', status: 'failure', httpStatus: response.status, message: errorText, clientId } })
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
