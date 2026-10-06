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
    // ffetch attaches the failing Response as the error's cause.
    const httpError = new Error('HTTP error: 401 Unauthorized')
    httpError.cause = { status: 401, statusText: 'Unauthorized' }
    mockAuthHttpClient.mockRejectedValue(httpError)

    await expect(generateTokenViaClientSecret()).rejects.toThrow(
      'Auth failed: 401 Unauthorized'
    )
  })

  test('reports an unreachable endpoint when the error carries no response', async () => {
    const networkError = new Error('fetch failed')
    networkError.cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    mockAuthHttpClient.mockRejectedValue(networkError)

    await expect(generateTokenViaClientSecret()).rejects.toThrow(
      'Unable to reach token endpoint: fetch failed'
    )
  })
})
