import { ClientAssertionCredential } from '@azure/identity'
import { WebIdentityTokenProvider, MockProvider } from '@defra/hapi-auth-oidc'
import { config } from '../../config/index.js'
import { createLogger } from '../../logging/logger.js'

const logger = createLogger()

const DEFAULT_TOKEN_LIFETIME_SECONDS = 3600

const buildAuthProvider = () => {
  const { audience, enableMocking } = config.get('auth.federatedCredentials')

  return enableMocking
    ? new MockProvider({})
    : new WebIdentityTokenProvider({ audience })
}

const generateTokenViaFederatedCredentials = async () => {
  const { tenantId, clientId, scope } = config.get('auth')

  const authProvider = buildAuthProvider()

  const credential = new ClientAssertionCredential(
    tenantId,
    clientId,
    () => authProvider.getCredentials(logger)
  )

  let tokenResponse
  try {
    tokenResponse = await credential.getToken(scope)
  } catch (err) {
    throw new Error(`Unable to obtain CRM access token: ${err.message}`)
  }

  if (!tokenResponse?.token) {
    throw new Error('Auth failed: no access token returned from Entra ID')
  }

  // If the token already expired (e.g. clock skew), treat it as 0 seconds remaining
  const expiresIn = tokenResponse.expiresOnTimestamp
    ? Math.max(0, Math.round((tokenResponse.expiresOnTimestamp - Date.now()) / 1000))
    : DEFAULT_TOKEN_LIFETIME_SECONDS

  return {
    token: `Bearer ${tokenResponse.token}`,
    expiresIn
  }
}

export { generateTokenViaFederatedCredentials }
