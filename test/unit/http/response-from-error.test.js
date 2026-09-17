import { describe, test, expect } from 'vitest'

import { responseFromError } from '../../../src/http/response-from-error.js'

describe('responseFromError', () => {
  test('returns the Response carried as the error cause', () => {
    const response = { status: 401, statusText: 'Unauthorized' }
    const error = Object.assign(new Error('HTTP error: 401'), { cause: response })

    expect(responseFromError(error)).toBe(response)
  })

  test('returns undefined when the cause is not a Response', () => {
    const error = Object.assign(new Error('fetch failed'), { cause: new Error('connect ECONNREFUSED') })

    expect(responseFromError(error)).toBeUndefined()
  })

  test('returns undefined when there is no cause', () => {
    expect(responseFromError(new Error('boom'))).toBeUndefined()
  })

  test('returns undefined for a null error', () => {
    expect(responseFromError(null)).toBeUndefined()
  })

  test('ignores a cause whose status is not a number', () => {
    const error = Object.assign(new Error('odd'), { cause: { status: '401' } })

    expect(responseFromError(error)).toBeUndefined()
  })
})
