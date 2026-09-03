import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { createClient as createChaosClient } from '@fetchkit/chaos-fetch'

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockLogger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() }

const { mockConfigGet, configWith } = vi.hoisted(() => {
  const defaultRetryConfig = {
    'retry.http.timeoutMs': 5000,
    'retry.http.authTimeoutMs': 2000,
    'retry.http.triageTimeoutMs': 1000,
    'retry.http.maxAttempts': 3,
    'retry.http.triageMaxAttempts': 1,
    'retry.http.unknownMaxAttempts': 2,
    'retry.http.baseDelayMs': 0, // no real delay in tests
    'retry.http.backoffMultiplier': 1,
    'retry.http.jitterPercentage': 0,
    'retry.http.maxDelayMs': 0,
    'retry.http.unknownMaxDelayMs': 0,
    'retry.http.retryAfterMaxDelayMs': 60000
  }

  const configWith = (overrides = {}) => (key) => {
    const merged = { ...defaultRetryConfig, ...overrides }
    return key in merged ? merged[key] : null
  }

  return {
    configWith,
    mockConfigGet: vi.fn().mockImplementation(configWith())
  }
})

vi.mock('../../../src/config/index.js', () => ({
  config: { get: mockConfigGet }
}))

vi.mock('../../../src/logging/logger.js', () => ({
  createLogger: () => mockLogger
}))

const { httpClient, authHttpClient, AbortError, TimeoutError, computeRetryDelay, parseRetryAfterMs } = await import('../../../src/http/client.js')

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
    await expect(httpClient(url, { fetchHandler })).rejects.toThrow('HTTP error: 404')
    expect(calls).toBe(1)
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          type: 'http_retry_decision',
          action: 'retry_decision',
          reason: 'http_404'
        }),
        tenant: { message: expect.stringMatching(/attempts=1.*category=non-retryable.*willRetry=false/) }
      }),
      expect.any(String)
    )
  })
})

describe('httpClient — retryable errors (5xx / 429)', () => {
  test('retries on 500 up to maxAttempts', async () => {
    let calls = 0
    const fetchHandler = async () => { calls++; return new Response('error', { status: 500 }) }
    await expect(httpClient(url, { fetchHandler })).rejects.toThrow('HTTP error: 500')
    expect(calls).toBe(3)
  })

  test('retries on 429 up to maxAttempts', async () => {
    let calls = 0
    const fetchHandler = async () => { calls++; return new Response('rate limited', { status: 429 }) }
    await expect(httpClient(url, { fetchHandler })).rejects.toThrow('HTTP error: 429')
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
        tenant: { message: 'attempts=2 category=retryable' }
      }),
      expect.any(String)
    )
  })
})

describe('httpClient — non-retryable errors (4xx)', () => {
  test('does not retry on 400', async () => {
    let calls = 0
    const fetchHandler = async () => { calls++; return new Response('bad request', { status: 400 }) }
    await expect(httpClient(url, { fetchHandler })).rejects.toThrow('HTTP error: 400')
    expect(calls).toBe(1)
  })

  test('does not retry on 403', async () => {
    let calls = 0
    const fetchHandler = async () => { calls++; return new Response('forbidden', { status: 403 }) }
    await expect(httpClient(url, { fetchHandler })).rejects.toThrow('HTTP error: 403')
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
      terminalReason: 'ECONNREFUSED',
      status: null
    })
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          type: 'http_retry_terminal',
          action: 'request_failed',
          outcome: 'failure'
        }),
        tenant: { message: 'attempts=3 category=retryable' }
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
      terminalReason: 'mystery failure',
      status: null
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
        tenant: { message: expect.stringMatching(/category=unknown.*willRetry=true/) }
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
        tenant: { message: 'attempts=2 category=unknown' }
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
        tenant: { message: 'attempts=2 category=retryable' }
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

describe('httpClient — non-idempotent write duplicate suppression (412)', () => {
  test('retries a transient 500 then stops on a non-retryable 412 (Dataverse conditional upsert)', async () => {
    let calls = 0
    const fetchHandler = async () => {
      calls++
      if (calls === 1) return new Response('error', { status: 500 })
      return new Response('', { status: 412 })
    }
    await expect(httpClient(url, { fetchHandler })).rejects.toThrow('HTTP error: 412')
    expect(calls).toBe(2)
  })
})

describe('parseRetryAfterMs — header forms', () => {
  const withHeader = (value) => new Response('', { status: 429, headers: { 'Retry-After': value } })

  test('reads a delay-seconds value', () => {
    expect(parseRetryAfterMs(withHeader('30'))).toBe(30000)
  })

  test('tolerates surrounding whitespace', () => {
    expect(parseRetryAfterMs(withHeader('  30  '))).toBe(30000)
  })

  test('reads an HTTP-date value as the remaining time', () => {
    const future = new Date(Date.now() + 30000).toUTCString()
    const parsed = parseRetryAfterMs(withHeader(future))
    expect(parsed).toBeGreaterThan(28000)
    expect(parsed).toBeLessThanOrEqual(30000)
  })

  test('clamps an HTTP-date already in the past to zero', () => {
    const past = new Date(Date.now() - 30000).toUTCString()
    expect(parseRetryAfterMs(withHeader(past))).toBe(0)
  })

  test('returns null when the header is absent', () => {
    expect(parseRetryAfterMs(new Response('', { status: 429 }))).toBeNull()
  })

  test.each([
    ['whitespace only', '   '],
    ['garbage', 'soon-ish'],
    ['negative', '-5'],
    ['decimal', '1.5'],
    ['hexadecimal', '0x10'],
    ['exponential', '1e3'],
    ['malformed HTTP-date', 'Mon, 99 Notamonth 2015 07:28:00 GMT']
  ])('returns null for a %s value so the computed backoff is used', (_label, value) => {
    expect(parseRetryAfterMs(withHeader(value))).toBeNull()
  })
})

describe('computeRetryDelay — Retry-After on 429', () => {
  const ctxFor = (status, headers) => ({
    attempt: 1,
    request: new Request(url),
    response: new Response('', { status, headers })
  })

  test('honours the advertised Retry-After in preference to the computed backoff', () => {
    expect(computeRetryDelay(ctxFor(429, { 'Retry-After': '5' }))).toBe(5000)
  })

  test('bounds the advertised Retry-After by its own ceiling', () => {
    // retryAfterMaxDelayMs is 60s in the test config
    expect(computeRetryDelay(ctxFor(429, { 'Retry-After': '600' }))).toBe(60000)
  })

  test('is not bounded by the much lower backoff cap', () => {
    // maxDelayMs is mocked to 0 in this suite; the advertised delay must survive
    expect(mockConfigGet('retry.http.maxDelayMs')).toBe(0)
    expect(computeRetryDelay(ctxFor(429, { 'Retry-After': '5' }))).toBe(5000)
  })

  test('falls back to the computed backoff when Retry-After is absent', () => {
    expect(computeRetryDelay(ctxFor(429))).toBe(0)
  })

  test('ignores Retry-After on statuses other than 429', () => {
    expect(computeRetryDelay(ctxFor(503, { 'Retry-After': '5' }))).toBe(0)
  })
})

describe('httpClient — Retry-After on 429 end to end', () => {
  afterEach(() => {
    mockConfigGet.mockImplementation(configWith())
  })

  test('sleeps for the advertised duration before retrying', async () => {
    // Kept short deliberately: this asserts the delay is actually applied by
    // the transport. The precise value is asserted in computeRetryDelay above,
    // where no wall-clock timing is involved.
    mockConfigGet.mockImplementation(configWith({ 'retry.http.retryAfterMaxDelayMs': 200 }))

    let calls = 0
    const timestamps = []
    const fetchHandler = async () => {
      timestamps.push(Date.now())
      calls++
      if (calls === 1) {
        return new Response('rate limited', { status: 429, headers: { 'Retry-After': '1' } })
      }
      return new Response('ok', { status: 200 })
    }

    const res = await httpClient(url, { fetchHandler })
    expect(res.status).toBe(200)
    expect(calls).toBe(2)
    expect(timestamps[1] - timestamps[0]).toBeGreaterThanOrEqual(150)
  })

  test('falls back to the computed backoff when Retry-After is absent', async () => {
    let calls = 0
    const fetchHandler = async () => {
      calls++
      if (calls === 1) return new Response('rate limited', { status: 429 })
      return new Response('ok', { status: 200 })
    }
    const start = Date.now()
    const res = await httpClient(url, { fetchHandler })
    const elapsed = Date.now() - start
    expect(res.status).toBe(200)
    // retry.http.baseDelayMs is mocked to 0 in this test config
    expect(elapsed).toBeLessThan(500)
  })
})

describe('onComplete logging — failing responses are not reported as recoveries', () => {
  test('does not log a recovery when a retried request settles on an HTTP failure', async () => {
    let calls = 0
    const fetchHandler = async () => {
      calls++
      if (calls === 1) return new Response('error', { status: 500 })
      return new Response('', { status: 412 })
    }

    await expect(httpClient(url, { fetchHandler })).rejects.toThrow('HTTP error: 412')

    const recoveryLogs = mockLogger.info.mock.calls.filter(
      ([, message]) => message === 'HTTP request recovered after retry'
    )
    expect(recoveryLogs).toHaveLength(0)
  })

  test('still logs a recovery when a retried request genuinely succeeds', async () => {
    let calls = 0
    const fetchHandler = async () => {
      calls++
      if (calls === 1) return new Response('error', { status: 500 })
      return new Response('ok', { status: 200 })
    }

    await httpClient(url, { fetchHandler })

    const recoveryLogs = mockLogger.info.mock.calls.filter(
      ([, message]) => message === 'HTTP request recovered after retry'
    )
    expect(recoveryLogs).toHaveLength(1)
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
    await expect(authHttpClient(url, { fetchHandler })).rejects.toThrow('HTTP error: 500')
    expect(calls).toBe(3)
  })

  test('does not retry on 401 (non-retryable)', async () => {
    let calls = 0
    const fetchHandler = async () => { calls++; return new Response('unauthorized', { status: 401 }) }
    await expect(authHttpClient(url, { fetchHandler })).rejects.toThrow('HTTP error: 401')
    expect(calls).toBe(1)
  })
})

describe('retryMetadata.status field', () => {
  test('status is null for network errors', async () => {
    const fetchHandler = async () => { throw new Error('ECONNRESET') }
    let thrown
    try {
      await httpClient(url, { fetchHandler })
    } catch (err) {
      thrown = err
    }
    expect(thrown.retryMetadata.status).toBeNull()
  })

  test('status is null for unknown errors', async () => {
    const fetchHandler = async () => { throw new Error('mystery failure') }
    let thrown
    try {
      await httpClient(url, { fetchHandler })
    } catch (err) {
      thrown = err
    }
    expect(thrown.retryMetadata.status).toBeNull()
  })

  test('status field is present in retryMetadata shape', async () => {
    const fetchHandler = async () => { throw new Error('ECONNRESET') }
    let thrown
    try {
      await httpClient(url, { fetchHandler })
    } catch (err) {
      thrown = err
    }
    expect(thrown.retryMetadata).toHaveProperty('status')
    expect(thrown.retryMetadata).toMatchObject({
      attempts: expect.any(Number),
      category: expect.any(String),
      terminalReason: expect.any(String),
      status: null
    })
  })

  test('reports a numeric HTTP status in the retry decision log and does not claim recovery', async () => {
    const fetchHandler = async () => new Response('error', { status: 503 })
    await expect(httpClient(url, { fetchHandler })).rejects.toThrow('HTTP error: 503')

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ reason: 'http_503' })
      }),
      'HTTP retry policy decision'
    )

    // The request exhausted its retries and threw. throwOnHttpError builds that
    // error after onComplete has run, so the hook sees a failing response with
    // no error argument; reporting it as a recovery would be misleading.
    const recoveryLogs = mockLogger.info.mock.calls.filter(
      ([, message]) => message === 'HTTP request recovered after retry'
    )
    expect(recoveryLogs).toHaveLength(0)
  })
})
