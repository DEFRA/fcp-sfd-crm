import { describe, test, expect, vi, afterAll, beforeEach, afterEach } from 'vitest'

import { config } from '../../../../../src/config/index.js'

// Deliberately not mocking @defra/cdp-metrics here: this proves the "never throws to the
// caller" guarantee against the actual dependency, not a fabricated mock of it. CRM's compose
// files do not set AWS_EMF_ENVIRONMENT (unlike object-processor's), so leaving it unset would
// let aws-embedded-metrics auto-detect its environment via a metadata-service probe, which is
// both slow and non-deterministic across machines/CI. Setting AWS_EMF_ENVIRONMENT and
// AWS_EMF_AGENT_ENDPOINT explicitly, before the library is imported, skips that probe and
// points it at a deliberately unreachable local port, so the flush failure (and the resulting
// warning) happens the same way every time this test runs.
const originalEmfEnvironment = process.env.AWS_EMF_ENVIRONMENT
const originalEmfAgentEndpoint = process.env.AWS_EMF_AGENT_ENDPOINT

// Set at module scope, before the dynamic imports below, rather than in beforeAll: the
// imports run during file collection, ahead of any test lifecycle hook, so a beforeAll
// assignment here would not reliably apply before the helper (and the real library) load.
process.env.AWS_EMF_ENVIRONMENT = 'Agent'
process.env.AWS_EMF_AGENT_ENDPOINT = 'tcp://127.0.0.1:1'

afterAll(() => {
  if (originalEmfEnvironment === undefined) {
    delete process.env.AWS_EMF_ENVIRONMENT
  } else {
    process.env.AWS_EMF_ENVIRONMENT = originalEmfEnvironment
  }

  if (originalEmfAgentEndpoint === undefined) {
    delete process.env.AWS_EMF_AGENT_ENDPOINT
  } else {
    process.env.AWS_EMF_AGENT_ENDPOINT = originalEmfAgentEndpoint
  }
})

vi.mock('../../../../../src/logging/logger.js', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

const { createLogger } = await import('../../../../../src/logging/logger.js')
const { metricsCounter } = await import('../../../../../src/api/common/helpers/metrics.js')

const mockLogger = createLogger()

describe('#metrics with the real @defra/cdp-metrics library', () => {
  const originalIsMetricsEnabled = config.get('isMetricsEnabled')

  beforeEach(() => {
    config.set('isMetricsEnabled', true)
  })

  afterEach(() => {
    config.set('isMetricsEnabled', originalIsMetricsEnabled)
  })

  test('Should resolve without throwing, and log the real flush failure against an unreachable sink', async () => {
    await expect(metricsCounter('real-library-check')).resolves.toBeUndefined()
    expect(mockLogger.warn).toHaveBeenCalled()
  })
})
