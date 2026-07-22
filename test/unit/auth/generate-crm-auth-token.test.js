import { describe, test, expect, vi, beforeEach } from 'vitest'

const mockGetCredentials = vi.fn()
const mockGetToken = vi.fn()

vi.mock('@defra/hapi-auth-oidc', () => ({
  WebIdentityTokenProvider: vi.fn(function () {
    this.getCredentials = mockGetCredentials
  }),
  MockProvider: vi.fn(function () {
    this.getCredentials = mockGetCredentials
  })
}))

vi.mock('@azure/identity', () => ({
  ClientAssertionCredential: vi.fn(function () {
    this.getToken = mockGetToken
  })
}))

vi.mock('../../../src/config/index.js', () => ({
  config: {
    get: vi.fn()
  }
}))

vi.mock('../../../src/logging/logger.js', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

vi.mock('../../../src/http/client.js', () => ({
  authHttpClient: vi.fn()
}))

const { WebIdentityTokenProvider, MockProvider } = await import('@defra/hapi-auth-oidc')
const { ClientAssertionCredential } = await import('@azure/identity')
const { config } = await import('../../../src/config/index.js')
const { authHttpClient } = await import('../../../src/http/client.js')
const { generateCrmAuthToken } = await import('../../../src/auth/generate-crm-auth-token.js')

const baseAuthConfig = {
  tenantId: 'fake-tenant',
  clientId: 'fake-client',
  clientSecret: 'fake-secret',
  tokenEndpoint: 'https://login.microsoftonline.com/tenant/oauth2/v2.0/token',
  scope: 'https://fake.crm/.default'
}

const baseFederatedConfig = {
  audience: 'fcp-sfd-crm',
  enableMocking: false
}

describe('generateCrmAuthToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('federated credentials path', () => {
    beforeEach(() => {
      config.get.mockImplementation((key) => {
        if (key === 'auth') return baseAuthConfig
        if (key === 'auth.federatedCredentials') return baseFederatedConfig
      })
      mockGetCredentials.mockResolvedValue('fake-web-identity-jwt')
      mockGetToken.mockResolvedValue({
        token: 'entra-access-token',
        expiresOnTimestamp: Date.now() + 3_600_000
      })
    })

    describe('when enableMocking is false', () => {
      test('uses WebIdentityTokenProvider', async () => {
        await generateCrmAuthToken()

        expect(WebIdentityTokenProvider).toHaveBeenCalledWith({ audience: 'fcp-sfd-crm' })
        expect(MockProvider).not.toHaveBeenCalled()
      })

      test('returns a Bearer token with expiresIn', async () => {
        const result = await generateCrmAuthToken()

        expect(result.token).toBe('Bearer entra-access-token')
        expect(result.expiresIn).toBeGreaterThan(0)
      })

      test('passes tenantId and clientId to ClientAssertionCredential', async () => {
        await generateCrmAuthToken()

        expect(ClientAssertionCredential).toHaveBeenCalledWith(
          'fake-tenant',
          'fake-client',
          expect.any(Function)
        )
      })

      test('calls getToken with the configured scope', async () => {
        await generateCrmAuthToken()

        expect(mockGetToken).toHaveBeenCalledWith('https://fake.crm/.default')
      })
    })

    describe('when enableMocking is true', () => {
      test('uses MockProvider instead of WebIdentityTokenProvider', async () => {
        config.get.mockImplementation((key) => {
          if (key === 'auth') return baseAuthConfig
          if (key === 'auth.federatedCredentials') return { ...baseFederatedConfig, enableMocking: true }
        })

        await generateCrmAuthToken()

        expect(MockProvider).toHaveBeenCalled()
        expect(WebIdentityTokenProvider).not.toHaveBeenCalled()
      })
    })

    describe('error handling', () => {
      test('throws when getToken rejects', async () => {
        mockGetToken.mockRejectedValue(new Error('AADSTS500011: wrong audience'))

        await expect(generateCrmAuthToken()).rejects.toThrow(
          'Unable to obtain CRM access token: AADSTS500011: wrong audience'
        )
      })

      test('throws when getToken returns null', async () => {
        mockGetToken.mockResolvedValue(null)

        await expect(generateCrmAuthToken()).rejects.toThrow(
          'Auth failed: no access token returned from Entra ID'
        )
      })

      test('throws when getToken returns object with no token field', async () => {
        mockGetToken.mockResolvedValue({ expiresOnTimestamp: Date.now() + 3_600_000 })

        await expect(generateCrmAuthToken()).rejects.toThrow(
          'Auth failed: no access token returned from Entra ID'
        )
      })
    })
  })

  describe('client secret path', () => {
    beforeEach(() => {
      config.get.mockImplementation((key) => {
        if (key === 'auth') return baseAuthConfig
        if (key === 'auth.federatedCredentials') return { audience: null, enableMocking: false }
      })
    })

    test('posts form-encoded credentials to the token endpoint', async () => {
      authHttpClient.mockResolvedValue({
        ok: true,
        json: async () => ({
          token_type: 'Bearer',
          access_token: 'oauth-access-token',
          expires_in: 3600
        })
      })

      const result = await generateCrmAuthToken()

      expect(authHttpClient).toHaveBeenCalledWith(
        baseAuthConfig.tokenEndpoint,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        })
      )
      expect(result).toEqual({
        token: 'Bearer oauth-access-token',
        expiresIn: 3600
      })
    })

    test('throws when the HTTP request fails', async () => {
      authHttpClient.mockRejectedValue(new Error('ECONNREFUSED'))

      await expect(generateCrmAuthToken()).rejects.toThrow(
        'Unable to reach token endpoint: ECONNREFUSED'
      )
    })

    test('throws when the response is not ok', async () => {
      const httpError = new Error('HTTP error: 401 Unauthorized')
      httpError.response = { status: 401, statusText: 'Unauthorized' }
      authHttpClient.mockRejectedValue(httpError)

      await expect(generateCrmAuthToken()).rejects.toThrow(
        'Auth failed: 401 Unauthorized'
      )
    })
  })
})
