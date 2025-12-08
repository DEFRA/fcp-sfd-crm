import { getToken, setToken } from '../repos/token.js'
import { generateCrmAuthToken } from './generate-crm-auth-token.js'

const getCrmAuthToken = async () => {
  // Try to get cached token
  const token = await getToken()

  if (token) {
    return token
  }

  // Generate new token if not found or expired
  const { token: newToken, expiresAt } = await generateCrmAuthToken()
  await setToken(newToken, expiresAt)

  return newToken
}

export {
  getCrmAuthToken
}
