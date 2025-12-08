import { getToken, setToken } from '../repos/token.js'
import { getCrmAuthToken } from './generate-crm-auth-token.js'

const getCrmAuthToken = async () => {
  // Try to get cached token
  let token = await getToken();
  
  if (token) {
    return token;
  }
  
  // Generate new token if not found or expired
  const { token: newToken, expiresAt } = await generateCrmAuthToken();
  await setToken(newToken, expiresAt);
  
  return newToken;
};