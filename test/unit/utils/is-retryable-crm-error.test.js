import { describe, test, expect } from 'vitest'
import { isRetryableCrmError } from '../../../src/utils/is-retryable-crm-error.js'

describe('isRetryableCrmError', () => {
  test.each(['retryable', 'unknown'])('returns true for %s CRM errors', (category) => {
    expect(isRetryableCrmError({ retryMetadata: { category } })).toBe(true)
  })

  test.each(['non-retryable', undefined])('returns false for %s CRM errors', (category) => {
    expect(isRetryableCrmError({ retryMetadata: { category } })).toBe(false)
  })

  test('returns false when retry metadata is missing', () => {
    expect(isRetryableCrmError(new Error('CRM error'))).toBe(false)
  })
})
