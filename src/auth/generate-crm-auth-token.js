import { config } from '../config/index.js'
import { generateTokenViaFederatedCredentials } from './strategies/federated-credentials.js'
import { generateTokenViaClientSecret } from './strategies/client-secret.js'

const useFederatedCredentials = () => {
  const { audience, disabled } = config.get('auth.federatedCredentials')
  return !disabled && Boolean(audience)
}

const generateCrmAuthToken = async () => {
  return useFederatedCredentials()
    ? generateTokenViaFederatedCredentials()
    : generateTokenViaClientSecret()
}

export {
  generateCrmAuthToken
}
