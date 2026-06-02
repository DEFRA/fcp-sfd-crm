import { describe, test, expect, vi, beforeEach } from 'vitest'
import { createClient as createChaosClient } from '@fetchkit/chaos-fetch'

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockLogger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() }

const { mockConfigGet } = vi.hoisted(() => ({
  mockConfigGet: vi.fn().mockImplementation((key) => {
    switch (key) {
      case 'retry.http.timeoutMs': return 5000
      case 'retry.http.authTimeoutMs': return 2000
      case 'retry.http.maxAttempts': return 3
      case 'retry.http.unknownMaxAttempts': return 2
      case 'retry.http.baseDelayMs': return 0   // no real delay in tests
      case 'retry.http.backoffMultiplier': return 1
      case 'retry.http.jitterPercentage': return 0
      case 'retry.http.maxDelayMs': return 0
      case 'retry.http.unknownMaxDelayMs': return 0
      default: return null
    }
  })
}))

vi.mock('../../../src/config/index.js', () => ({
  config: { get: mockConfigGet }
}))

vi.mock('../../../src/logging/logger.js', () => ({
  createLogger: () => mockLogger
}))

const { httpClient, authHttpClient } = await import('../../../src/http/client.js')

// ─── Helpers ─────────────────────────────────────────────────────────────────

const url = 'http://test-crm/resource'

const alwaysRespond = (status, body = '') =>
  createChaosClient({ global: [{ mock: { status, body } }] })

const failFirstNThenOk = (n, status = 500) =>
  createChaosClient({
    global: [
      { failFirstN: { n, status } },
      { mock: { status: 200, body: 'ok' } }
    ]
  })

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

describe('httpClient — successful requests', () => {
  test('returns 200 response', async () => {
    const fetchHandler = alwaysRespond(200, 'ok')
    const res = await httpClient(url, { fetchHandler })
    expect(res.status).toBe(200)
  })

  test('returns 404 without retrying (non-retryable)', async () => {
    let calls = 0
    const fetchHandler = async () => { calls++; return new Response('not found', { status: 404 }) }
    await httpClient(url, { fetchHandler })
    expect(calls).toBe(1)
  })
})

describe('httpClient — retryable errors (5xx / 429)', () => {
  test('retries on 500 up to maxAttempts', async () => {
    let calls = 0
    const fetchHandler = async () => { calls++; return new Response('error', { status: 500 }) }
    await httpClient(url, { fetchHandler })
    expect(calls).toBe(3)
  })

  test('retries on 429 up to maxAttempts', async () => {
    let calls = 0
    const fetchHandler = async () => { calls++; return new Response('rate limited', { status: 429 }) }
    await httpClient(url, { fetchHandler })
    expect(calls).toBe(3)
  })

  test('succeeds on retry after transient 500', async () => {
    const fetchHandler = failFirstNThenOk(1, 500)
    const res = await httpClient(url, { fetchHandler })
    expect(res.status).toBe(200)
  })
})

describe('httpClient — non-retryable errors (4xx)', () => {
  test('does not retry on 400', async () => {
    let calls = 0
    const fetchHandler = async () => { calls++; return new Response('bad request', { status: 400 }) }
    await httpClient(url, { fetchHandler })
    expect(calls).toBe(1)
  })

  test('does not retry on 403', async () => {
    let calls = 0
    const fetchHandler = async () => { calls++; return new Response('forbidden', { status: 403 }) }
    await httpClient(url, { fetchHandler })
    expect(calls).toBe(1)
  })
})

describe('httpClient — network errors (retryable)', () => {
  test('retries on ECONNREFUSED', async () => {
    let calls = 0
    const fetchHandler = async () => {
      calls++
      throw Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' })
    }
    await expect(httpClient(url, { fetchHandler })).rejects.toThrow()
    expect(calls).toBe(3)
  })
})

describe('httpClient — unknown errors', () => {
  test('applies conservative retry budget (unknownMaxAttempts = 2)', async () => {
    let calls = 0
    const fetchHandler = async () => {
      calls++
      throw new Error('some completely unexpected error')
    }
    await expect(httpClient(url, { fetchHandler })).rejects.toThrow()
    expect(calls).toBe(2)
  })

  test('logs warn on first unknown error', async () => {
    const fetchHandler = async () => { throw new Error('mystery failure') }
    await expect(httpClient(url, { fetchHandler })).rejects.toThrow()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ type: 'http_unknown_error', outcome: 'unknown' })
      }),
      expect.any(String)
    )
  })

  test('logs error when unknown retries exhausted', async () => {
    const fetchHandler = async () => { throw new Error('mystery failure') }
    await expect(httpClient(url, { fetchHandler })).rejects.toThrow()
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ type: 'http_unknown_error_exhausted', outcome: 'failure' })
      }),
      expect.any(String)
    )
  })

  test('logs warn only once per request (attempt 1 only)', async () => {
    const fetchHandler = async () => { throw new Error('mystery failure') }
    await expect(httpClient(url, { fetchHandler })).rejects.toThrow()
    expect(mockLogger.warn).toHaveBeenCalledTimes(1)
  })
})

describe('authHttpClient — distinct client with shorter timeout', () => {
  test('returns 200 response', async () => {
    const fetchHandler = alwaysRespond(200, 'token-response')
    const res = await authHttpClient(url, { fetchHandler })
    expect(res.status).toBe(200)
  })

  test('retries on 500 up to maxAttempts', async () => {
    let calls = 0
    const fetchHandler = async () => { calls++; return new Response('error', { status: 500 }) }
    await authHttpClient(url, { fetchHandler })
    expect(calls).toBe(3)
  })

  test('does not retry on 401 (non-retryable)', async () => {
    let calls = 0
    const fetchHandler = async () => { calls++; return new Response('unauthorized', { status: 401 }) }
    await authHttpClient(url, { fetchHandler })
    expect(calls).toBe(1)
  })
})
