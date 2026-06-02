import { describe, it, beforeEach, afterEach, vi, expect } from 'vitest'

vi.mock('../../../src/config/index.js', () => ({
  config: {
    get: vi.fn().mockImplementation((key) => {
      if (key === 'apiKeyForTestingCaseCreation') return 'test-api-key'
      if (key === 'port') return 0
      if (key === 'root') return process.cwd()
      if (key === 'log') {
        return {
          isEnabled: true,
          redact: [],
          level: 'info',
          format: 'pino-pretty'
        }
      }
    })
  }
}))

vi.mock('../../../src/auth/get-crm-auth-token.js', () => ({
  getCrmAuthToken: vi.fn().mockResolvedValue('token')
}))

vi.mock('../../../src/services/create-case-with-online-submission-in-crm.js', () => ({
  createCaseWithOnlineSubmissionInCrm: vi.fn().mockResolvedValue({ caseId: '123-abc' })
}))

const { config } = await import('../../../src/config/index.js')
const { createServer } = await import('../../../src/server.js')

describe('Create case payload validation', () => {
  let server

  beforeEach(async () => {
    config.get.mockImplementation((key) => {
      if (key === 'cdpEnvironment') return 'dev'
      if (key === 'apiKeyForTestingCaseCreation') return 'test-api-key'
      if (key === 'port') return 0
      if (key === 'root') return process.cwd()
      if (key === 'log') {
        return {
          isEnabled: true,
          redact: [],
          level: 'info',
          format: 'pino-pretty'
        }
      }
    })

    server = await createServer()
    await server.initialize()
  })

  afterEach(async () => {
    vi.clearAllMocks()
    if (server && server.stop) await server.stop()
  })

  it('returns 400 for invalid payload', async () => {
    const invalidPayload = { foo: 'bar' }

    const res = await server.inject({
      method: 'POST',
      url: '/create-case-with-online-submission',
      headers: { 'x-api-key': 'test-api-key' },
      payload: invalidPayload
    })

    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.payload)
    expect(body).toHaveProperty('error', 'Invalid request payload')
    expect(body).toHaveProperty('details')
    expect(Array.isArray(body.details)).toBe(true)
    const { createCaseWithOnlineSubmissionInCrm } = await import('../../../src/services/create-case-with-online-submission-in-crm.js')
    expect(createCaseWithOnlineSubmissionInCrm).not.toHaveBeenCalled()
  })
})
