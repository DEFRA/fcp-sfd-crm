import { createClient, NetworkError, TimeoutError, AbortError } from '@fetchkit/ffetch'
import { config } from '../config/index.js'
import { createLogger } from '../logging/logger.js'

const logger = createLogger()

// Matches node-level network error codes that are safe to retry
const RETRYABLE_NETWORK_ERROR = /ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EPIPE|EAI_AGAIN/i

const HTTP_TOO_MANY_REQUESTS = 429
const HTTP_SERVER_ERROR_MIN = 500
const HTTP_CLIENT_ERROR_MIN = 400

const classifyResponseStatus = (status) => {
  if (status === HTTP_TOO_MANY_REQUESTS || status >= HTTP_SERVER_ERROR_MIN) {
    return 'retryable'
  }
  if (status >= HTTP_CLIENT_ERROR_MIN) {
    return 'nonRetryable'
  }
  return null
}

// Classify an ffetch RetryContext into one of three buckets:
//   'retryable'    – known-safe to retry (network failures, timeouts, 5xx/429)
//   'nonRetryable' – must not retry (4xx, user abort)
//   'unknown'      – unrecognised; conservative retry applies
const classifyError = (ctx) => {
  const { error, response } = ctx

  if (error instanceof AbortError) {
    return 'nonRetryable'
  }
  if (error instanceof TimeoutError || error instanceof NetworkError) {
    return 'retryable'
  }
  if (error instanceof Error && RETRYABLE_NETWORK_ERROR.test(error.message)) {
    return 'retryable'
  }

  if (response) {
    const statusClass = classifyResponseStatus(response.status)
    if (statusClass) {
      return statusClass
    }
  }

  return error ? 'unknown' : 'nonRetryable'
}

const calcDelay = (attempt, baseDelayMs, backoffMultiplier, jitterPct, capMs) => {
  const base = baseDelayMs * Math.pow(backoffMultiplier, attempt - 1)
  // Math.random() is intentional here — jitter for retry backoff, not security-sensitive
  const jitter = base * (jitterPct / 100) * Math.random() // NOSONAR
  return Math.min(base + jitter, capMs)
}

const errorMessage = (err) => {
  if (err instanceof Error) { return err.message }
  if (typeof err === 'string') { return err }
  return JSON.stringify(err)
}

const makeClient = (timeout) => createClient({
  timeout,
  // Upper bound – shouldRetry enforces the per-class budget
  retries: Math.max(
    config.get('retry.http.maxAttempts'),
    config.get('retry.http.unknownMaxAttempts')
  ) - 1,
  throwOnHttpError: false,
  shouldRetry: (ctx) => {
    const cls = classifyError(ctx)
    if (cls === 'nonRetryable') {
      return false
    }
    const limit = cls === 'unknown'
      ? config.get('retry.http.unknownMaxAttempts')
      : config.get('retry.http.maxAttempts')
    if (cls === 'unknown' && ctx.attempt === 1) {
      logger.warn({
        event: {
          type: 'http_unknown_error',
          outcome: 'unknown',
          reason: errorMessage(ctx.error)
        }
      }, 'HTTP request encountered unknown error — applying conservative retry')
    }
    const willRetry = ctx.attempt < limit
    if (cls === 'unknown' && !willRetry) {
      logger.error({
        event: {
          type: 'http_unknown_error_exhausted',
          outcome: 'failure',
          reason: errorMessage(ctx.error)
        }
      }, 'HTTP request unknown error retries exhausted')
    }
    return willRetry
  },
  retryDelay: (ctx) => {
    const cls = classifyError(ctx)
    const cap = cls === 'unknown'
      ? config.get('retry.http.unknownMaxDelayMs')
      : config.get('retry.http.maxDelayMs')
    return calcDelay(
      ctx.attempt,
      config.get('retry.http.baseDelayMs'),
      config.get('retry.http.backoffMultiplier'),
      config.get('retry.http.jitterPercentage'),
      cap
    )
  }
})

// Standard CRM API client
export const httpClient = makeClient(config.get('retry.http.timeoutMs'))

// Shorter timeout for auth/token requests
export const authHttpClient = makeClient(config.get('retry.http.authTimeoutMs'))

export { NetworkError, TimeoutError, AbortError }
