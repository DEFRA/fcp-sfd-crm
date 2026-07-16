import { describe, test, expect, vi, beforeEach } from 'vitest'

const mockAuthHttpClient = vi.fn()

vi.mock('../../../../src/http/client.js', () => ({
  authHttpClient: (...args) => mockAuthHttpClient(...args)
}))

vi.mock('../../../../src/config/index.js', () => ({
  config: {
    get: vi.fn()
  }
}))

const { config } = await import('../../../../src/config/index.js')
const { generateTokenViaClientSecret } = await import('../../../../src/auth/strategies/client-secret.js')

const baseAuthConfig = {
  tokenEndpoint: 'https://login.microsoftonline.com/tenant/oauth2/v2.0/token',
  clientId: 'fake-client',
  clientSecret: 'fake-secret',
  scope: 'https://fake.crm/.default'
}

describe('generateTokenViaClientSecret', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    config.get.mockImplementation((key) => {
      if (key === 'auth') return baseAuthConfig
    })
  })

  test('posts form-encoded credentials to the token endpoint', async () => {
    mockAuthHttpClient.mockResolvedValue({
      ok: true,
      json: async () => ({
        token_type: 'Bearer',
        access_token: 'oauth-access-token',
        expires_in: 3600
      })
    })

    const result = await generateTokenViaClientSecret()

    expect(mockAuthHttpClient).toHaveBeenCalledWith(
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
    mockAuthHttpClient.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(generateTokenViaClientSecret()).rejects.toThrow(
      'Unable to reach token endpoint: ECONNREFUSED'
    )
  })

  test('throws when the response is not ok', async () => {
    mockAuthHttpClient.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'invalid_client'
    })

    await expect(generateTokenViaClientSecret()).rejects.toThrow(
      'Auth failed: 401 Unauthorized - invalid_client'
    )
  })
})
