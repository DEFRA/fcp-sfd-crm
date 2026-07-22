import { config } from '../../config/index.js'
import { authHttpClient } from '../../http/client.js'

const generateTokenViaClientSecret = async () => {
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
    const status = err.response?.status
    if (status) {
      throw new Error(`Auth failed: ${status} ${err.response.statusText}`)
    }
    throw new Error(`Unable to reach token endpoint: ${err.message}`)
  }

  const payload = await response.json()

  return {
    token: `${payload.token_type} ${payload.access_token}`,
    expiresIn: payload.expires_in
  }
}

export { generateTokenViaClientSecret }
