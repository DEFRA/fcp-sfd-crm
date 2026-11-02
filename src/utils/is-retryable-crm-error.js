const RETRYABLE_CATEGORIES = ['retryable', 'unknown']

export const isRetryableCrmError = (error) =>
  RETRYABLE_CATEGORIES.includes(error?.retryMetadata?.category)
