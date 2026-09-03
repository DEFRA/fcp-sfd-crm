import { createClient, NetworkError, TimeoutError, AbortError } from '@fetchkit/ffetch'
import { config } from '../config/index.js'
import { createLogger } from '../logging/logger.js'
import { toTenantMessage } from '../logging/tenant-message.js'

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
  return 'nonRetryable'
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
    return classifyResponseStatus(response.status)
  }

  return error ? 'unknown' : 'nonRetryable'
}

const calcDelay = (attempt, baseDelayMs, backoffMultiplier, jitterPct, capMs) => {
  const base = baseDelayMs * Math.pow(backoffMultiplier, attempt - 1)
  // Math.random() is intentional here — jitter for retry backoff, not security-sensitive
  const jitter = base * (jitterPct / 100) * Math.random() // NOSONAR
  return Math.min(base + jitter, capMs)
}

// Retry-After is either a number of seconds or an HTTP date (RFC 9110 §10.2.3),
// which specifies delay-seconds as 1*DIGIT. Number() alone is too permissive:
// it accepts whitespace, signs, decimals and hex, none of which are valid.
const DELAY_SECONDS_PATTERN = /^\d+$/
// All three HTTP-date formats RFC 9110 permits begin with a day name. Checking
// for one first stops Date.parse from salvaging a date out of a malformed
// delay-seconds value: Date.parse('-5'), for instance, yields the year 5 BC.
const HTTP_DATE_PATTERN = /^(mon|tue|wed|thu|fri|sat|sun)/i
const MS_PER_SECOND = 1000

const parseRetryAfterMs = (response) => {
  const header = response?.headers.get('retry-after')
  if (!header) {
    return null
  }

  const trimmed = header.trim()
  if (DELAY_SECONDS_PATTERN.test(trimmed)) {
    return Number(trimmed) * MS_PER_SECOND
  }

  if (!HTTP_DATE_PATTERN.test(trimmed)) {
    return null
  }

  const dateMs = Date.parse(trimmed)
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - Date.now()) : null
}

const errorMessage = (err) => {
  if (err instanceof Error) { return err.message }
  if (typeof err === 'string') { return err }
  return JSON.stringify(err)
}

const toMetadataCategory = (classification) => (
  classification === 'nonRetryable' ? 'non-retryable' : classification
)

const buildTerminalReason = (ctx) => {
  if (ctx.response) {
    return `http_${ctx.response.status}`
  }

  return errorMessage(ctx.error)
}

const attachRetryMetadata = (error, metadata) => {
  if (!error || typeof error !== 'object') {
    return
  }

  error.retryMetadata = metadata
}

const buildRetryState = () => ({
  startedAtMs: Date.now(),
  lastAttempt: 0,
  finalAttempt: null,
  category: 'unknown',
  terminalReason: 'unknown_error'
})

const isRetryDecisionFailure = (ctx) => {
  if (ctx.error) {
    return true
  }

  return Boolean(ctx.response && ctx.response.status >= HTTP_CLIENT_ERROR_MIN)
}

// throwOnHttpError constructs its HttpError after the onComplete hook has run,
// so a failing response reaches that hook with no error argument. Reporting
// such a request as recovered would be misleading.
const isHttpFailureResponse = (response) =>
  Boolean(response && response.status >= HTTP_CLIENT_ERROR_MIN)

const retryDurationNs = (startedAtMs) => (Date.now() - startedAtMs) * 1_000_000

const logRetryDecision = ({ ctx, category, willRetry, limit, terminalReason, startedAtMs }) => {
  logger.warn({
    event: {
      type: 'http_retry_decision',
      action: 'retry_decision',
      category: 'http',
      outcome: willRetry ? 'unknown' : 'failure',
      reason: terminalReason,
      reference: ctx.request.url,
      duration: retryDurationNs(startedAtMs)
    },
    tenant: {
      message: toTenantMessage({ attempts: ctx.attempt, category, maxAttempts: limit, willRetry })
    }
  }, 'HTTP retry policy decision')
}

const beforeHook = (request, retryStateByRequest) => {
  retryStateByRequest.set(request, buildRetryState())
}

const onCompleteHook = (request, response, error, retryStateByRequest) => {
  const state = retryStateByRequest.get(request) ?? buildRetryState()
  retryStateByRequest.delete(request)

  // finalAttempt is set when shouldRetry returned false on a failure (early
  // exit path). In that case ctx.attempt is the real total. The +1 form
  // covers the loop-exhausted path where shouldRetry was never called on
  // the last failure, and the success path.
  const attempts = state.finalAttempt ?? Math.max(1, state.lastAttempt + 1)
  const httpStatusMatch = state.terminalReason?.match(/^http_(\d+)$/)
  const metadata = {
    attempts,
    category: state.category,
    terminalReason: state.terminalReason,
    status: httpStatusMatch ? Number.parseInt(httpStatusMatch[1], 10) : null
  }

  if (error) {
    attachRetryMetadata(error, metadata)
    logger.error({
      event: {
        type: 'http_retry_terminal',
        action: 'request_failed',
        category: 'http',
        outcome: 'failure',
        reason: metadata.terminalReason,
        reference: request.url,
        duration: retryDurationNs(state.startedAtMs),
        kind: error instanceof Error ? error.name : 'error'
      },
      error: {
        message: errorMessage(error)
      },
      tenant: {
        message: toTenantMessage({ attempts: metadata.attempts, category: metadata.category, status: metadata.status })
      }
    }, 'HTTP request failed after retry policy evaluation')
    return
  }

  if (attempts > 1 && !isHttpFailureResponse(response)) {
    logger.info({
      event: {
        type: 'http_retry_recovered',
        action: 'request_succeeded',
        category: 'http',
        outcome: 'success',
        reason: metadata.terminalReason,
        reference: request.url,
        duration: retryDurationNs(state.startedAtMs)
      },
      tenant: {
        message: toTenantMessage({ attempts: metadata.attempts, category: metadata.category })
      },
      http: {
        response: {
          status_code: response?.status
        }
      }
    }, 'HTTP request recovered after retry')
  }
}

const shouldRetryHook = (ctx, retryStateByRequest, retryLimits) => {
  if (!isRetryDecisionFailure(ctx)) {
    return false
  }

  const cls = classifyError(ctx)
  const category = toMetadataCategory(cls)
  const terminalReason = buildTerminalReason(ctx)
  const limit = cls === 'unknown'
    ? retryLimits.unknownMaxAttempts
    : retryLimits.maxAttempts
  const willRetry = cls !== 'nonRetryable' && ctx.attempt < limit

  const existingState = retryStateByRequest.get(ctx.request) ?? buildRetryState()
  existingState.lastAttempt = Math.max(existingState.lastAttempt, ctx.attempt)
  existingState.category = category
  existingState.terminalReason = terminalReason
  // When shouldRetry returns false for a failure, ctx.attempt is already
  // the correct total — store it so onComplete does not add 1 again.
  if (!willRetry && (ctx.error || (ctx.response && ctx.response.status >= HTTP_CLIENT_ERROR_MIN))) {
    existingState.finalAttempt = ctx.attempt
  }
  retryStateByRequest.set(ctx.request, existingState)

  logRetryDecision({
    ctx,
    category,
    willRetry,
    limit,
    terminalReason,
    startedAtMs: existingState.startedAtMs
  })

  return willRetry
}

const computeRetryDelay = (ctx) => {
  const cls = classifyError(ctx)
  const cap = cls === 'unknown'
    ? config.get('retry.http.unknownMaxDelayMs')
    : config.get('retry.http.maxDelayMs')

  if (ctx.response?.status === HTTP_TOO_MANY_REQUESTS) {
    const retryAfterMs = parseRetryAfterMs(ctx.response)
    if (retryAfterMs !== null) {
      // Dataverse advertises how long to wait before its throttling clears.
      // Retrying sooner than instructed only prolongs the throttling, so the
      // advertised delay takes priority over the computed backoff and is
      // bounded by its own higher ceiling rather than the backoff cap.
      return Math.min(retryAfterMs, config.get('retry.http.retryAfterMaxDelayMs'))
    }
  }

  return calcDelay(
    ctx.attempt,
    config.get('retry.http.baseDelayMs'),
    config.get('retry.http.backoffMultiplier'),
    config.get('retry.http.jitterPercentage'),
    cap
  )
}

const makeClient = (timeout, retryLimits) => {
  const retryStateByRequest = new Map()

  return createClient({
    timeout,
    retries: Math.max(retryLimits.maxAttempts, retryLimits.unknownMaxAttempts) - 1,
    throwOnHttpError: true,
    hooks: {
      before: (request) => beforeHook(request, retryStateByRequest),
      onComplete: (request, response, error) => onCompleteHook(request, response, error, retryStateByRequest)
    },
    shouldRetry: (ctx) => shouldRetryHook(ctx, retryStateByRequest, retryLimits),
    retryDelay: computeRetryDelay
  })
}

const defaultRetryLimits = {
  maxAttempts: config.get('retry.http.maxAttempts'),
  unknownMaxAttempts: config.get('retry.http.unknownMaxAttempts')
}

const triageMaxAttempts = config.get('retry.http.triageMaxAttempts')
const triageRetryLimits = {
  maxAttempts: triageMaxAttempts,
  unknownMaxAttempts: triageMaxAttempts
}

// Standard CRM API client
export const httpClient = makeClient(config.get('retry.http.timeoutMs'), defaultRetryLimits)

// Shorter timeout for auth/token requests
export const authHttpClient = makeClient(config.get('retry.http.authTimeoutMs'), defaultRetryLimits)

// Best-effort client for triage writes: intentionally fail fast.
export const triageHttpClient = makeClient(config.get('retry.http.triageTimeoutMs'), triageRetryLimits)

export { NetworkError, TimeoutError, AbortError }

// Exported for direct unit testing of the retry delay decision, which is more
// precise and far less flaky than timing the resulting sleep.
export { computeRetryDelay, parseRetryAfterMs }
