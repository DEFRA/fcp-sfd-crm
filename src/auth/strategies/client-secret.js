import { config } from '../../config/index.js'
import { authHttpClient } from '../../http/client.js'
import { responseFromError } from '../../http/response-from-error.js'

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
    // ffetch carries the failing Response as the error's cause, not as a
    // `response` property. Reading the wrong one reported every rejected token
    // request as unreachable, hiding the actual 401 or 500.
    const response = responseFromError(err)
    if (response) {
      throw new Error(`Auth failed: ${response.status} ${response.statusText}`)
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
