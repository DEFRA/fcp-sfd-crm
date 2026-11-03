const RETRYABLE_CATEGORIES = new Set(['retryable', 'unknown'])

export const isRetryableCrmError = (error) =>
  RETRYABLE_CATEGORIES.has(error?.retryMetadata?.category)
