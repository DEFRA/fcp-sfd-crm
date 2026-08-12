import { describe, expect, test } from 'vitest'

import {
  getCorrelationId,
  runWithCorrelationId
} from '../../../src/logging/correlation-id-store.js'

describe('correlation ID store', () => {
  test('makes the correlation ID available throughout an asynchronous scope', async () => {
    await runWithCorrelationId('correlation-1', async () => {
      expect(getCorrelationId()).toBe('correlation-1')
      await Promise.resolve()
      expect(getCorrelationId()).toBe('correlation-1')
    })

    expect(getCorrelationId()).toBeUndefined()
  })

  test('keeps concurrent correlation scopes isolated', async () => {
    const values = await Promise.all([
      runWithCorrelationId('correlation-1', async () => {
        await Promise.resolve()
        return getCorrelationId()
      }),
      runWithCorrelationId('correlation-2', async () => {
        await Promise.resolve()
        return getCorrelationId()
      })
    ])

    expect(values).toEqual(['correlation-1', 'correlation-2'])
  })
})
