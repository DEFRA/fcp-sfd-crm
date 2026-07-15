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

vi.mock('../../../../src/config/index.js', () => ({
  config: {
    get: vi.fn()
  }
}))

vi.mock('../../../../src/logging/logger.js', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

const { WebIdentityTokenProvider, MockProvider } = await import('@defra/hapi-auth-oidc')
const { ClientAssertionCredential } = await import('@azure/identity')
const { config } = await import('../../../../src/config/index.js')
const { generateTokenViaFederatedCredentials } = await import('../../../../src/auth/strategies/federated-credentials.js')

const baseAuthConfig = {
  tenantId: 'fake-tenant',
  clientId: 'fake-client',
  scope: 'https://fake.crm/.default'
}

const baseFederatedConfig = {
  audience: 'fcp-sfd-crm',
  enableMocking: false
}

describe('generateTokenViaFederatedCredentials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
      await generateTokenViaFederatedCredentials()

      expect(WebIdentityTokenProvider).toHaveBeenCalledWith({ audience: 'fcp-sfd-crm' })
      expect(MockProvider).not.toHaveBeenCalled()
    })

    test('returns a Bearer token with expiresIn', async () => {
      const result = await generateTokenViaFederatedCredentials()

      expect(result.token).toBe('Bearer entra-access-token')
      expect(result.expiresIn).toBeGreaterThan(0)
    })

    test('passes tenantId and clientId to ClientAssertionCredential', async () => {
      await generateTokenViaFederatedCredentials()

      expect(ClientAssertionCredential).toHaveBeenCalledWith(
        'fake-tenant',
        'fake-client',
        expect.any(Function)
      )
    })

    test('assertion callback calls getCredentials', async () => {
      await generateTokenViaFederatedCredentials()

      const [, , assertionFn] = ClientAssertionCredential.mock.calls[0]
      await assertionFn()

      expect(mockGetCredentials).toHaveBeenCalled()
    })

    test('calls getToken with the configured scope', async () => {
      await generateTokenViaFederatedCredentials()

      expect(mockGetToken).toHaveBeenCalledWith('https://fake.crm/.default')
    })
  })

  describe('when enableMocking is true', () => {
    test('uses MockProvider instead of WebIdentityTokenProvider', async () => {
      config.get.mockImplementation((key) => {
        if (key === 'auth') return baseAuthConfig
        if (key === 'auth.federatedCredentials') return { ...baseFederatedConfig, enableMocking: true }
      })

      await generateTokenViaFederatedCredentials()

      expect(MockProvider).toHaveBeenCalled()
      expect(WebIdentityTokenProvider).not.toHaveBeenCalled()
    })
  })

  describe('expiresIn calculation', () => {
    test('returns default expiresIn of 3600 when expiresOnTimestamp is absent', async () => {
      mockGetToken.mockResolvedValue({ token: 'entra-access-token' })

      const result = await generateTokenViaFederatedCredentials()

      expect(result.expiresIn).toBe(3600)
    })

    test('clamps expiresIn to 0 when expiresOnTimestamp is in the past', async () => {
      mockGetToken.mockResolvedValue({
        token: 'entra-access-token',
        expiresOnTimestamp: Date.now() - 60_000
      })

      const result = await generateTokenViaFederatedCredentials()

      expect(result.expiresIn).toBe(0)
    })
  })

  describe('error handling', () => {
    test('throws when getToken rejects', async () => {
      mockGetToken.mockRejectedValue(new Error('AADSTS500011: wrong audience'))

      await expect(generateTokenViaFederatedCredentials()).rejects.toThrow(
        'Unable to obtain CRM access token: AADSTS500011: wrong audience'
      )
    })

    test('throws when getToken returns null', async () => {
      mockGetToken.mockResolvedValue(null)

      await expect(generateTokenViaFederatedCredentials()).rejects.toThrow(
        'Auth failed: no access token returned from Entra ID'
      )
    })

    test('throws when getToken returns object with no token field', async () => {
      mockGetToken.mockResolvedValue({ expiresOnTimestamp: Date.now() + 3_600_000 })

      await expect(generateTokenViaFederatedCredentials()).rejects.toThrow(
        'Auth failed: no access token returned from Entra ID'
      )
    })
  })
})
