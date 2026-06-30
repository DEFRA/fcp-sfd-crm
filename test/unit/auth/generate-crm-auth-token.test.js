import { describe, test, expect, vi, beforeEach } from 'vitest'

// Thing under test
import { generateCrmAuthToken } from '../../../src/auth/generate-crm-auth-token.js'

// Mock dependencies
import { config } from '../../../src/config/index.js'

const { mockAuthHttpClient, mockSendAuditEvent } = vi.hoisted(() => ({
  mockAuthHttpClient: vi.fn(),
  mockSendAuditEvent: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../../../src/http/client.js', () => ({
  authHttpClient: mockAuthHttpClient
}))

vi.mock('../../../src/config/index.js', () => ({
  config: {
    get: vi.fn()
  }
}))

vi.mock('../../../src/messaging/outbound/audit/send-audit-event.js', () => ({
  sendAuditEvent: mockSendAuditEvent
}))

describe('generateCrmAuthToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    config.get.mockImplementation((key) => {
      if (key === 'auth') return {
        clientId: 'fake-client',
        clientSecret: 'fake-secret',
        scope: 'fake-scope',
        tokenEndpoint: 'https://login.microsoftonline.com/fake-tenant/oauth2/v2.0/token'
      }
      return undefined
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

  test('should use token endpoint value from config in fetch URL', async () => {
    mockAuthHttpClient.mockResolvedValue(mockSuccessResponse)

    await generateCrmAuthToken()

    expect(mockAuthHttpClient).toHaveBeenCalledWith(
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
    mockAuthHttpClient.mockResolvedValue(mockFailResponse)
    await expect(generateCrmAuthToken()).rejects.toThrow('Auth failed: 401 Unauthorized - Invalid credentials')
    expect(mockSendAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ security: expect.objectContaining({ status: 'failure' }) })
    )
  })

  test('should return object with token and expiresAt property', async () => {
    mockAuthHttpClient.mockResolvedValue(mockSuccessResponse)

    const result = await generateCrmAuthToken()

    expect(result).toEqual({
      token: 'Bearer test-token',
      expiresAt: 3600
    })
    expect(result).toHaveProperty('token')
    expect(result).toHaveProperty('expiresAt')
  })

  test('should send correct form data with URL encoding', async () => {
    mockAuthHttpClient.mockResolvedValue(mockSuccessResponse)

    await generateCrmAuthToken()

    const fetchCall = mockAuthHttpClient.mock.calls[0]
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

  test('should throw error when token endpoint is down', async () => {
    mockAuthHttpClient.mockRejectedValue(new Error('Network error'))
    await expect(generateCrmAuthToken()).rejects.toThrow('Unable to reach token endpoint: Network error')
    expect(mockSendAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ security: expect.objectContaining({ status: 'failure' }) })
    )
  })
})
