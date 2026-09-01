import { describe, test, beforeEach, afterEach, vi, expect } from 'vitest'

vi.mock('../../src/config/index.js', () => ({
  config: {
    get: vi.fn().mockImplementation((key) => {
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

const { createServer } = await import('../../src/server.js')

describe('createServer', () => {
  let server

  beforeEach(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterEach(async () => {
    if (server && server.stop) {
      await server.stop()
    }
    vi.clearAllMocks()
  })

  test('starts a server that registers no routes of its own', () => {
    expect(server.table()).toHaveLength(0)
  })

  test('applies the platform security headers to every response', async () => {
    const res = await server.inject({ method: 'GET', url: '/' })

    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['strict-transport-security']).toContain('max-age=31536000')
  })
})
