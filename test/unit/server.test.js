import { describe, it, beforeEach, afterEach, afterAll, vi, expect } from 'vitest'

vi.mock('../../src/config/index.js', () => ({
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

vi.mock('../../src/auth/get-crm-auth-token.js', () => ({
  getCrmAuthToken: vi.fn().mockResolvedValue('token')
}))

vi.mock('../../src/services/create-case-in-crm.js', () => ({
  createCaseInCrm: vi.fn().mockResolvedValue({ id: 123 })
}))

vi.mock('../../src/services/create-case-with-online-submission-in-crm.js', () => ({
  createCaseWithOnlineSubmissionInCrm: vi.fn().mockResolvedValue({ caseId: '123-abc' })
}))

const { config } = await import('../../src/config/index.js')
const { getCrmAuthToken } = await import('../../src/auth/get-crm-auth-token.js')
const { createCaseInCrm } = await import('../../src/services/create-case-in-crm.js')
const { createCaseWithOnlineSubmissionInCrm } = await import('../../src/services/create-case-with-online-submission-in-crm.js')
const { createServer } = await import('../../src/server.js')

describe('POST methods for creating cases in CRM', () => {
  describe('in a non-prod environment', () => {
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
    })

    afterAll(async () => {
      if (server && server.stop) {
        await server.stop()
      }
    })

    it('returns 401 if API key is missing on /create-case', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/create-case',
        payload: { foo: 'bar' }
      })

      expect(res.statusCode).toBe(401)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Missing or invalid QA-specific x-api-key header' })
    })

    it('returns 401 if API key is invalid on /create-case', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/create-case',
        headers: { 'x-api-key': 'wrong-key' },
        payload: { foo: 'bar' }
      })

      expect(res.statusCode).toBe(401)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Missing or invalid QA-specific x-api-key header' })
    })

    it('calls createCaseInCrm and returns result if API key is valid', async () => {
      const payload = {
        caseType: 'DOCUMENT_UPLOAD',
        crn: '123456',
        sbi: '654321',
        caseData: { title: 'Test case', caseDescription: 'Test description' },
        onlineSubmissionActivity: {
          subject: 'Test subject',
          description: 'Test subject description',
          scheduledStart: '2026-01-01T10:00:00Z',
          scheduledEnd: '2026-01-01T11:00:00Z',
          stateCode: 0,
          statusCode: 1,
          metadata: {
            name: 'mock-file.pdf',
            documentType: 'mock-doc-type',
            fileUrl: 'https://file.url',
            copiedFileUrl: 'https://copied.file.url'
          }
        }
      }

      const res = await server.inject({
        method: 'POST',
        url: '/create-case',
        headers: { 'x-api-key': 'test-api-key' },
        payload
      })

      expect(getCrmAuthToken).toHaveBeenCalled()

      expect(createCaseInCrm).toHaveBeenCalledWith({
        authToken: 'token',
        correlationId: expect.any(String),
        caseType: 'DOCUMENT_UPLOAD',
        crn: '123456',
        sbi: '654321',
        caseData: { title: 'Test case', caseDescription: 'Test description' },
        onlineSubmissionActivity: {
          subject: 'Test subject',
          description: 'Test subject description',
          scheduledStart: '2026-01-01T10:00:00Z',
          scheduledEnd: '2026-01-01T11:00:00Z',
          stateCode: 0,
          statusCode: 1,
          metadata: {
            name: 'mock-file.pdf',
            documentType: 'mock-doc-type',
            fileUrl: 'https://file.url',
            copiedFileUrl: 'https://copied.file.url'
          }
        }
      })

      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload)).toEqual({ caseResult: { id: 123 } })
    })

    it('returns 401 if API key is missing on /create-case-with-online-submission', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/create-case-with-online-submission',
        payload: { foo: 'bar' }
      })

      expect(res.statusCode).toBe(401)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Missing or invalid QA-specific x-api-key header' })
    })

    it('returns 401 if API key is invalid on /create-case-with-online-submission', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/create-case-with-online-submission',
        headers: { 'x-api-key': 'wrong-key' },
        payload: { foo: 'bar' }
      })

      expect(res.statusCode).toBe(401)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Missing or invalid QA-specific x-api-key header' })
    })

    it('calls createCaseWithOnlineSubmissionInCrm if API key is valid', async () => {
      const payload = {
        caseType: 'DOCUMENT_UPLOAD',
        crn: '123456',
        sbi: '654321',
        caseData: { title: 'Test case', caseDescription: 'Test description' },
        onlineSubmissionActivity: {
          subject: 'Test subject',
          description: 'Test subject description',
          scheduledStart: '2026-01-01T10:00:00Z',
          scheduledEnd: '2026-01-01T11:00:00Z',
          stateCode: 0,
          statusCode: 1,
          metadata: {
            name: 'mock-file.pdf',
            documentType: 'mock-doc-type',
            fileUrl: 'https://file.url',
            copiedFileUrl: 'https://copied.file.url'
          }
        }
      }

      const res = await server.inject({
        method: 'POST',
        url: '/create-case-with-online-submission',
        headers: { 'x-api-key': 'test-api-key' },
        payload
      })

      expect(getCrmAuthToken).toHaveBeenCalled()

      expect(createCaseWithOnlineSubmissionInCrm).toHaveBeenCalledWith({
        authToken: 'token',
        correlationId: expect.any(String),
        caseType: 'DOCUMENT_UPLOAD',
        crn: '123456',
        sbi: '654321',
        caseData: { title: 'Test case', caseDescription: 'Test description' },
        onlineSubmissionActivity: {
          subject: 'Test subject',
          description: 'Test subject description',
          scheduledStart: '2026-01-01T10:00:00Z',
          scheduledEnd: '2026-01-01T11:00:00Z',
          stateCode: 0,
          statusCode: 1,
          metadata: {
            name: 'mock-file.pdf',
            documentType: 'mock-doc-type',
            fileUrl: 'https://file.url',
            copiedFileUrl: 'https://copied.file.url'
          }
        }
      })

      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload)).toEqual({ caseResult: { caseId: '123-abc' } })
    })
  })

  describe('in a prod environment', () => {
    let server

    beforeEach(async () => {
      config.get.mockImplementation((key) => {
        if (key === 'cdpEnvironment') return 'prod'
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
    })

    afterAll(async () => {
      if (server && server.stop) {
        await server.stop()
      }
    })

    it('returns 404 if route does not exist in prod on /create-case', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/create-case',
        headers: { 'x-api-key': 'test-api-key' },
        payload: { foo: 'bar' }
      })

      expect(res.statusCode).toBe(404)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Not Found', message: 'Not Found', statusCode: 404 })
    })

    it('returns 404 if route does not exist in prod on /create-case-with-online-submission', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/create-case-with-online-submission',
        headers: { 'x-api-key': 'test-api-key' },
        payload: { foo: 'bar' }
      })

      expect(res.statusCode).toBe(404)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Not Found', message: 'Not Found', statusCode: 404 })
    })
  })
})
