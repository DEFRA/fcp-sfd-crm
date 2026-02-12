import { describe, test, expect, vi, beforeEach } from 'vitest'

// Mock dependencies
vi.mock('../../../src/repos/token.js', () => ({
  getToken: vi.fn(),
  setToken: vi.fn()
}))

vi.mock('../../../src/auth/generate-crm-auth-token.js', () => ({
  generateCrmAuthToken: vi.fn()
}))

// Import after mocks
const { getCrmAuthToken } = await import('../../../src/auth/get-crm-auth-token.js')
const { getToken, setToken } = await import('../../../src/repos/token.js')
const { generateCrmAuthToken } = await import('../../../src/auth/generate-crm-auth-token.js')

describe('getCrmAuthToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('when cached token exists and is valid', () => {
    test('should return cached token without generating new one', async () => {
      const cachedToken = 'Bearer cached-token-12345'
      getToken.mockResolvedValue(cachedToken)

      const result = await getCrmAuthToken()

      expect(getToken).toHaveBeenCalledOnce()
      expect(generateCrmAuthToken).not.toHaveBeenCalled()
      expect(setToken).not.toHaveBeenCalled()
      expect(result).toBe(cachedToken)
    })
  })

  describe('when getToken returns null', () => {
    test('should generate new token, cache it and return it', async () => {
      getToken.mockResolvedValue(null)
      generateCrmAuthToken.mockResolvedValue({
        token: 'Bearer new-token-67890',
        expiresAt: 3600
      })

      const result = await getCrmAuthToken()

      expect(getToken).toHaveBeenCalledOnce()
      expect(generateCrmAuthToken).toHaveBeenCalledOnce()
      expect(setToken).toHaveBeenCalledWith('Bearer new-token-67890', 3600)
      expect(result).toBe('Bearer new-token-67890')
    })
  })
})
