import { describe, test, expect } from 'vitest'

import { ALLOWED_METRIC_DIMENSION_KEYS, ALLOWED_METRIC_DIMENSION_VALUES } from '../../../src/constants/metrics.js'

const MAX_ALLOWED_VALUES_PER_KEY = 10

describe('#metrics constants', () => {
  test('Each allowed dimension key has a corresponding value set', () => {
    ALLOWED_METRIC_DIMENSION_KEYS.forEach((key) => {
      expect(ALLOWED_METRIC_DIMENSION_VALUES[key]).toBeDefined()
    })
  })

  test('Each value set has no more than the permitted number of values', () => {
    Object.entries(ALLOWED_METRIC_DIMENSION_VALUES).forEach(([key, values]) => {
      expect(values.length).toBeLessThanOrEqual(MAX_ALLOWED_VALUES_PER_KEY)
    })
  })
})
