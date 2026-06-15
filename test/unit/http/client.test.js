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

const { httpClient, authHttpClient, AbortError, TimeoutError } = await import('../../../src/http/client.js')

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
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          type: 'http_retry_decision',
          action: 'retry_decision',
          reason: 'http_404'
        }),
        retry: expect.objectContaining({
          attempts: 1,
          category: 'non-retryable',
          willRetry: false
        })
      }),
      expect.any(String)
    )
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
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          type: 'http_retry_recovered',
          action: 'request_succeeded',
          outcome: 'success'
        }),
        retry: expect.objectContaining({
          attempts: 2,
          category: 'retryable',
          terminalReason: 'http_500'
        })
      }),
      expect.any(String)
    )
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
  test('does not retry on AbortError (non-retryable)', async () => {
    let calls = 0
    const fetchHandler = async () => {
      calls++
      throw new AbortError('aborted by user')
    }

    await expect(httpClient(url, { fetchHandler })).rejects.toThrow('aborted by user')
    expect(calls).toBe(1)
  })

  test('retries on TimeoutError class instances', async () => {
    let calls = 0
    const fetchHandler = async () => {
      calls++
      throw new TimeoutError('operation timed out')
    }

    await expect(httpClient(url, { fetchHandler })).rejects.toThrow('operation timed out')
    expect(calls).toBe(3)
  })

  test('retries on ECONNREFUSED', async () => {
    let calls = 0
    const fetchHandler = async () => {
      calls++
      throw Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' })
    }
    let thrown
    try {
      await httpClient(url, { fetchHandler })
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown.retryMetadata).toEqual({
      attempts: 3,
      category: 'retryable',
      terminalReason: 'ECONNREFUSED'
    })
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          type: 'http_retry_terminal',
          action: 'request_failed',
          outcome: 'failure'
        }),
        retry: expect.objectContaining({
          attempts: 3,
          category: 'retryable',
          terminalReason: 'ECONNREFUSED'
        })
      }),
      expect.any(String)
    )
    expect(calls).toBe(3)
  })
})

describe('httpClient — unknown errors', () => {
  test('handles thrown string errors and keeps metadata attach safe', async () => {
    // eslint-disable-next-line no-throw-literal
    const fetchHandler = async () => { throw 'string failure' }
    await expect(httpClient(url, { fetchHandler })).rejects.toMatchObject({
      name: 'RetryLimitError',
      cause: 'string failure',
      retryMetadata: {
        attempts: 2,
        category: 'unknown',
        terminalReason: 'string failure'
      }
    })
  })

  test('handles thrown object errors and stringifies message', async () => {
    const customError = Object.assign(new Error('E_CUSTOM'), { code: 'E_CUSTOM', detail: 'x' })
    const fetchHandler = async () => { throw customError }
    let thrown
    try {
      await httpClient(url, { fetchHandler })
    } catch (err) {
      thrown = err
    }

    expect(thrown).toEqual(
      expect.objectContaining({
        retryMetadata: expect.objectContaining({ category: 'unknown' })
      })
    )
  })

  test('applies conservative retry budget (unknownMaxAttempts = 2)', async () => {
    let calls = 0
    const fetchHandler = async () => {
      calls++
      throw new Error('some completely unexpected error')
    }
    await expect(httpClient(url, { fetchHandler })).rejects.toThrow()
    expect(calls).toBe(2)
  })

  test('enriches terminal unknown errors with retry metadata', async () => {
    const fetchHandler = async () => { throw new Error('mystery failure') }
    let thrown
    try {
      await httpClient(url, { fetchHandler })
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown.retryMetadata).toEqual({
      attempts: 2,
      category: 'unknown',
      terminalReason: 'mystery failure'
    })
  })

  test('logs retry decision for unknown errors', async () => {
    const fetchHandler = async () => { throw new Error('mystery failure') }
    await expect(httpClient(url, { fetchHandler })).rejects.toThrow()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          type: 'http_retry_decision',
          action: 'retry_decision',
          outcome: 'unknown',
          reason: 'mystery failure'
        }),
        retry: expect.objectContaining({
          category: 'unknown',
          willRetry: true
        })
      }),
      expect.any(String)
    )
  })

  test('logs terminal error when unknown retries exhausted', async () => {
    const fetchHandler = async () => { throw new Error('mystery failure') }
    await expect(httpClient(url, { fetchHandler })).rejects.toThrow()
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          type: 'http_retry_terminal',
          action: 'request_failed',
          outcome: 'failure',
          reason: 'mystery failure'
        }),
        retry: expect.objectContaining({
          attempts: 2,
          category: 'unknown',
          terminalReason: 'mystery failure'
        })
      }),
      expect.any(String)
    )
  })

  test('does NOT log recovery for immediate success (attempts=1)', async () => {
    const fetchHandler = alwaysRespond(200, 'ok')
    const res = await httpClient(url, { fetchHandler })
    expect(res.status).toBe(200)
    // Verify no recovery log was emitted (only attempt count is 1)
    expect(mockLogger.info).not.toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ type: 'http_retry_recovered' })
      }),
      expect.any(String)
    )
  })

  test('does NOT log terminal error on successful response', async () => {
    const fetchHandler = alwaysRespond(200, 'ok')
    const res = await httpClient(url, { fetchHandler })
    expect(res.status).toBe(200)
    expect(mockLogger.error).not.toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ type: 'http_retry_terminal' })
      }),
      expect.any(String)
    )
  })

  test('logs recovery on network error + retry success with attempts > 1', async () => {
    const fetchHandler = failFirstNThenOk(1)
    const res = await httpClient(url, { fetchHandler })
    expect(res.status).toBe(200)
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          type: 'http_retry_recovered',
          action: 'request_succeeded',
          outcome: 'success'
        }),
        retry: expect.objectContaining({
          attempts: 2,
          category: 'retryable'
        })
      }),
      expect.stringContaining('recovered')
    )
  })

  test('enriches thrown network error with retryMetadata', async () => {
    const fetchHandler = async () => { throw new Error('ECONNREFUSED') }
    const err = await httpClient(url, { fetchHandler }).catch(e => e)
    expect(err.retryMetadata).toEqual(
      expect.objectContaining({
        attempts: 3,
        category: 'retryable',
        terminalReason: 'ECONNREFUSED'
      })
    )
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
