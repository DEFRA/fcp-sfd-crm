import { describe, test, expect, vi, beforeEach } from 'vitest'

// Thing under test
import { getCrmAuthToken } from '../../../src/auth/get-crm-auth-token.js'

// Mock dependencies
import { config } from '../../../src/config/index.js'

// Mock global fetch
global.fetch = vi.fn()

vi.mock('../../../src/config/index.js', () => ({
  config: {
    get: vi.fn()
  }
}))

describe('getCrmAuthToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    config.get.mockReturnValue({
      clientId: 'fake-client',
      clientSecret: 'fake-secret',
      scope: 'fake-scope',
      tenantId: 'fake-tenant'
    })
  })

  const mockSuccessResponse = {
    ok: true,
    json: vi.fn().mockResolvedValue({
      token_type: 'Bearer',
      access_token: 'test-token',
      expires_in: 3600
    })
  }

  test('should use tenantId value from config in fetch URL', async () => {
    global.fetch.mockResolvedValue(mockSuccessResponse)

    await getCrmAuthToken()

    expect(global.fetch).toHaveBeenCalledWith(
      'https://login.microsoftonline.com/fake-tenant/oauth2/v2.0/token',
      expect.objectContaining({
        method: 'POST'
      })
    )
  })

  test('should throw error when response is not 200 OK', async () => {
    const mockFailResponse = {
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: vi.fn().mockResolvedValue('Invalid credentials')
    }
    global.fetch.mockResolvedValue(mockFailResponse)

    await expect(getCrmAuthToken()).rejects.toThrow(
      'Auth failed: 401 Unauthorized - Invalid credentials'
    )
  })

  test('should return object with token and expiresAt property', async () => {
    global.fetch.mockResolvedValue(mockSuccessResponse)

    const result = await getCrmAuthToken()

    expect(result).toEqual({
      token: 'Bearer test-token',
      expiresAt: 3600
    })
    expect(result).toHaveProperty('token')
    expect(result).toHaveProperty('expiresAt')
  })

  test('should send correct form data with URL encoding', async () => {
    global.fetch.mockResolvedValue(mockSuccessResponse)

    await getCrmAuthToken()

    const fetchCall = global.fetch.mock.calls[0]
    const requestOptions = fetchCall[1]

    expect(requestOptions.method).toBe('POST')
    expect(requestOptions.headers).toEqual({
      'Content-Type': 'application/x-www-form-urlencoded'
    })
    expect(requestOptions.body).toContain('client_id=fake-client')
    expect(requestOptions.body).toContain('client_secret=fake-secret')
    expect(requestOptions.body).toContain('grant_type=client_credentials')
    expect(requestOptions.body).toContain('scope=fake-scope')
  })
})
