import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

import { config } from '../../../../../src/config/index.js'

// Deliberately not mocking @defra/cdp-metrics here: this proves the "never throws to the
// caller" guarantee against the actual dependency, not a fabricated mock of it. Whether the
// flush itself succeeds or fails depends on AWS_EMF_ENVIRONMENT (e.g. compose.yaml sets
// Local, where it writes straight to stdout and never fails) so only the non-throwing
// contract is asserted, not whether a failure happened.
vi.mock('../../../../../src/logging/logger.js', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

const { metricsCounter } = await import('../../../../../src/api/common/helpers/metrics.js')

describe('#metrics with the real @defra/cdp-metrics library', () => {
  const originalIsMetricsEnabled = config.get('isMetricsEnabled')

  beforeEach(() => {
    config.set('isMetricsEnabled', true)
  })

  afterEach(() => {
    config.set('isMetricsEnabled', originalIsMetricsEnabled)
  })

  test('Should resolve without throwing', async () => {
    await expect(metricsCounter('real-library-check')).resolves.toBeUndefined()
  })
})
