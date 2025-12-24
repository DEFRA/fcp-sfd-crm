import { describe, it, beforeEach, afterEach, afterAll, vi, expect } from 'vitest'
import { config } from '../../src/config/index.js'
import { createServer } from '../../src/server.js'

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

describe('POST /create-case', () => {
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
      vi.resetAllMocks()
    })

    afterAll(async () => {
      if (server && server.stop) {
        await server.stop()
      }
    })

    it('returns 401 if API key is missing', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/create-case',
        payload: { foo: 'bar' }
      })
      expect(res.statusCode).toBe(401)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Missing or invalid QA-specific x-api-key header' })
    })

    it('returns 401 if API key is invalid', async () => {
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
      vi.mock('../../src/auth/get-crm-auth-token.js', () => ({
        getCrmAuthToken: vi.fn().mockResolvedValue('token')
      }))
      vi.mock('../../src/services/create-case-in-crm.js', () => ({
        createCaseInCrm: vi.fn().mockResolvedValue({ id: 123 })
      }))
      const { getCrmAuthToken } = await import('../../src/auth/get-crm-auth-token.js')
      const { createCaseInCrm } = await import('../../src/services/create-case-in-crm.js')

      const res = await server.inject({
        method: 'POST',
        url: '/create-case',
        headers: { 'x-api-key': 'test-api-key' },
        payload: { foo: 'bar' }
      })

      expect(getCrmAuthToken).toHaveBeenCalled()
      expect(createCaseInCrm).toHaveBeenCalledWith({ authToken: 'token', caseData: { foo: 'bar' } })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload)).toEqual({ caseResult: { id: 123 } })
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
      vi.resetAllMocks()
    })

    afterAll(async () => {
      if (server && server.stop) {
        await server.stop()
      }
    })
    it('returns 404 if route does not exist in prod', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/create-case',
        headers: { 'x-api-key': 'test-api-key' },
        payload: { foo: 'bar' }
      })
      expect(res.statusCode).toBe(404)
      expect(JSON.parse(res.payload)).toEqual({ error: 'Not Found', message: 'Not Found', statusCode: 404, })
    })
  })
})
