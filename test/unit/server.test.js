import { describe, test, beforeEach, afterEach, afterAll, vi, expect } from 'vitest'

vi.mock('../../src/config/index.js', () => ({
  config: {
    get: vi.fn().mockImplementation((key) => {
      if (key === 'apiKeyForTestingCaseCreation') return 'test-api-key'
      if (key === 'port') return 0
      if (key === 'root') return process.cwd()
      if (key === 'tracing.header') return 'x-cdp-request-id'
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

vi.mock('../../src/services/create-case-with-online-submission-in-crm.js', () => ({
  createCaseWithOnlineSubmissionInCrm: vi.fn().mockResolvedValue({ caseId: '123-abc' })
}))

vi.mock('../../src/messaging/outbound/audit/send-audit-event.js', () => ({
  emitAuditEvent: vi.fn().mockResolvedValue(undefined)
}))

const { config } = await import('../../src/config/index.js')
const { getCrmAuthToken } = await import('../../src/auth/get-crm-auth-token.js')
const { createCaseWithOnlineSubmissionInCrm } = await import('../../src/services/create-case-with-online-submission-in-crm.js')
const { emitAuditEvent } = await import('../../src/messaging/outbound/audit/send-audit-event.js')
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
        if (key === 'tracing.header') return 'x-cdp-request-id'
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

    test('returns 401 if API key is missing on /create-case-with-online-submission', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/create-case-with-online-submission',
        payload: { foo: 'bar' }
      })

      expect(res.statusCode).toBe(401)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Missing or invalid QA-specific x-api-key header' })
    })

    test('emits a security audit event (row 7) when the API key is missing', async () => {
      await server.inject({
        method: 'POST',
        url: '/create-case-with-online-submission',
        payload: { foo: 'bar' }
      })

      expect(emitAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationid: expect.any(String),
          security: expect.objectContaining({ pmccode: expect.any(String) }),
          audit: expect.objectContaining({ status: 'failure' })
        })
      )
    })

    // Regression test: request.info.id (the route's previous correlationId
    // source) is built by Hapi as `${received}:${hostname}:${pid}:${counter}`
    // and regularly exceeds the audit schema's 50-character correlationid
    // cap on a real pod hostname, silently discarding the row 7 event.
    // expect.any(String) above cannot catch that - only a length assertion
    // against the real schema constraint can.
    test('emits a correlationid that fits the audit schema length limit (max 50 characters)', async () => {
      await server.inject({
        method: 'POST',
        url: '/create-case-with-online-submission',
        payload: { foo: 'bar' }
      })

      const [event] = emitAuditEvent.mock.calls[0]
      expect(event.correlationid.length).toBeLessThanOrEqual(50)
    })

    test('uses the inbound x-cdp-request-id header as the correlationid when present', async () => {
      await server.inject({
        method: 'POST',
        url: '/create-case-with-online-submission',
        headers: { 'x-cdp-request-id': 'trace-id-from-caller' },
        payload: { foo: 'bar' }
      })

      const [event] = emitAuditEvent.mock.calls[0]
      expect(event.correlationid).toBe('trace-id-from-caller')
    })

    test('returns 401 if API key is invalid on /create-case-with-online-submission', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/create-case-with-online-submission',
        headers: { 'x-api-key': 'wrong-key' },
        payload: { foo: 'bar' }
      })

      expect(res.statusCode).toBe(401)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Missing or invalid QA-specific x-api-key header' })
    })

    test('emits a security audit event (row 7) when the API key is invalid', async () => {
      await server.inject({
        method: 'POST',
        url: '/create-case-with-online-submission',
        headers: { 'x-api-key': 'wrong-key' },
        payload: { foo: 'bar' }
      })

      expect(emitAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationid: expect.any(String),
          security: expect.objectContaining({ pmccode: expect.any(String) }),
          audit: expect.objectContaining({ status: 'failure' })
        })
      )
    })

    test('does not emit a security audit event when the API key is valid', async () => {
      await server.inject({
        method: 'POST',
        url: '/create-case-with-online-submission',
        headers: { 'x-api-key': 'test-api-key' },
        payload: {
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
              blobFileId: 'mock-blob-file-id'
            }
          }
        }
      })

      expect(emitAuditEvent).not.toHaveBeenCalled()
    })

    test('calls createCaseWithOnlineSubmissionInCrm if API key is valid', async () => {
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
            blobFileId: 'mock-blob-file-id'
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
            blobFileId: 'mock-blob-file-id'
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
        if (key === 'tracing.header') return 'x-cdp-request-id'
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

    test('returns 404 if route does not exist in prod on /create-case-with-online-submission', async () => {
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
