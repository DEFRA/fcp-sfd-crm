import { describe, test, expect, vi } from 'vitest'
import hapiPulse from 'hapi-pulse'
import { pulse } from '../../../../../src/api/common/helpers/pulse.js'
import { createLogger } from '../../../../../src/logging/logger.js'

vi.mock('hapi-pulse', () => ({
  default: vi.fn()
}))

vi.mock('../../../../../src/logging/logger.js', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

describe('pulse plugin', () => {
  test('Should export expected plugin object', () => {
    expect(pulse.plugin).toBe(hapiPulse)

    expect(createLogger).toHaveBeenCalled()
    expect(pulse.options.logger).toBeDefined()
    expect(pulse.options.timeout).toBe(10000)
  })

  test('Logger inside pulse should be a logger instance', () => {
    const loggerInstance = createLogger()
    expect(pulse.options.logger).toEqual(loggerInstance)
  })
})
