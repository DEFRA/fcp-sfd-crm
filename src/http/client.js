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
    retry: {
      attempts: ctx.attempt,
      category,
      terminalReason,
      maxAttempts: limit,
      willRetry
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
      retry: metadata
    }, 'HTTP request failed after retry policy evaluation')
    return
  }

  if (attempts > 1) {
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
      retry: metadata,
      http: {
        response: {
          status_code: response?.status
        }
      }
    }, 'HTTP request recovered after retry')
  }
}

const shouldRetryHook = (ctx, retryStateByRequest) => {
  if (!isRetryDecisionFailure(ctx)) {
    return false
  }

  const cls = classifyError(ctx)
  const category = toMetadataCategory(cls)
  const terminalReason = buildTerminalReason(ctx)
  const limit = cls === 'unknown'
    ? config.get('retry.http.unknownMaxAttempts')
    : config.get('retry.http.maxAttempts')
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
  return calcDelay(
    ctx.attempt,
    config.get('retry.http.baseDelayMs'),
    config.get('retry.http.backoffMultiplier'),
    config.get('retry.http.jitterPercentage'),
    cap
  )
}

const makeClient = (timeout) => {
  const retryStateByRequest = new Map()

  return createClient({
    timeout,
    retries: Math.max(
      config.get('retry.http.maxAttempts'),
      config.get('retry.http.unknownMaxAttempts')
    ) - 1,
    throwOnHttpError: false,
    hooks: {
      before: (request) => beforeHook(request, retryStateByRequest),
      onComplete: (request, response, error) => onCompleteHook(request, response, error, retryStateByRequest)
    },
    shouldRetry: (ctx) => shouldRetryHook(ctx, retryStateByRequest),
    retryDelay: computeRetryDelay
  })
}

// Standard CRM API client
export const httpClient = makeClient(config.get('retry.http.timeoutMs'))

// Shorter timeout for auth/token requests
export const authHttpClient = makeClient(config.get('retry.http.authTimeoutMs'))

export { NetworkError, TimeoutError, AbortError }
