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

const { registeredSecureContext } = vi.hoisted(() => ({
  registeredSecureContext: { context: 'from-secure-context-plugin' }
}))

vi.mock('../../src/data/db.js', () => ({
  connectDb: vi.fn(),
  closeDb: vi.fn()
}))

// The real plugin decorates server.secureContext only when the custom secure
// context is enabled, which it is not in tests. This stand-in always decorates
// a known object, so the test fails if mongoDb is registered before it and
// receives undefined.
vi.mock('../../src/api/common/helpers/secure-context/secure-context.js', () => ({
  secureContext: {
    plugin: {
      name: 'secure-context',
      register (server) {
        server.decorate('server', 'secureContext', registeredSecureContext)
      }
    }
  }
}))

const { createServer } = await import('../../src/server.js')
const { connectDb } = await import('../../src/data/db.js')

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

  test('connects to MongoDB with the secure context registered before it', () => {
    expect(connectDb).toHaveBeenCalledTimes(1)
    expect(connectDb).toHaveBeenCalledWith(registeredSecureContext)
  })

  test('applies the platform security headers to every response', async () => {
    const res = await server.inject({ method: 'GET', url: '/' })

    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['x-frame-options']).toBe('DENY')
    expect(res.headers['strict-transport-security']).toContain('max-age=31536000')
  })
})
