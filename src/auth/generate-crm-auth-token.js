import { config } from '../config/index.js'

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
    response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    })
  } catch (err) {
    throw new Error(`Unable to reach token endpoint: ${err.message}`)
  }

  if (!response.ok) {
    const errorText = await response.text()
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
