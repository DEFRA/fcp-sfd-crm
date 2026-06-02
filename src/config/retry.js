export const retryConfig = {
  retry: {
    http: {
      maxAttempts: {
        doc: 'Maximum total HTTP attempts for retryable errors',
        format: Number,
        default: 3,
        env: 'HTTP_RETRY_MAX_ATTEMPTS'
      },
      baseDelayMs: {
        doc: 'Base backoff delay in milliseconds for HTTP retries',
        format: Number,
        default: 500,
        env: 'HTTP_RETRY_BASE_DELAY_MS'
      },
      backoffMultiplier: {
        doc: 'Backoff multiplier applied between HTTP retry attempts',
        format: Number,
        default: 1.5,
        env: 'HTTP_RETRY_BACKOFF_MULTIPLIER'
      },
      jitterPercentage: {
        doc: 'Jitter percentage applied to HTTP retry delays',
        format: Number,
        default: 15,
        env: 'HTTP_RETRY_JITTER_PERCENTAGE'
      },
      maxDelayMs: {
        doc: 'Maximum delay in milliseconds between HTTP retry attempts',
        format: Number,
        default: 15000,
        env: 'HTTP_RETRY_MAX_DELAY_MS'
      },
      timeoutMs: {
        doc: 'Default timeout in milliseconds for CRM API HTTP requests',
        format: Number,
        default: 10000,
        env: 'CRM_HTTP_TIMEOUT_MS'
      },
      authTimeoutMs: {
        doc: 'Default timeout in milliseconds for CRM auth/token requests',
        format: Number,
        default: 5000,
        env: 'CRM_AUTH_HTTP_TIMEOUT_MS'
      },
      unknownMaxAttempts: {
        doc: 'Maximum total attempts for unknown errors',
        format: Number,
        default: 2,
        env: 'RETRY_UNKNOWN_MAX_ATTEMPTS'
      },
      unknownMaxDelayMs: {
        doc: 'Maximum delay in milliseconds between unknown error retries',
        format: Number,
        default: 10000,
        env: 'RETRY_UNKNOWN_MAX_DELAY_MS'
      }
    }
  }
}