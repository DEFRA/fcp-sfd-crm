import { describe, test, expect, vi } from 'vitest'
import hapiPulse from 'hapi-pulse'
import { pulse } from '../../../../../src/api/common/helpers/pulse.js'
import { createLogger } from '../../../../../src/logging/logger.js'
import { closeDb } from '../../../../../src/data/db.js'
import { stopMessaging } from '../../../../../src/messaging/inbound/index.js'

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

vi.mock('../../../../../src/data/db.js', () => ({
  closeDb: vi.fn()
}))

vi.mock('../../../../../src/messaging/inbound/index.js', () => ({
  stopMessaging: vi.fn()
}))

describe('pulse plugin', () => {
  test('Should export expected plugin object', async () => {
    vi.mocked(createLogger).mockClear()
    vi.resetModules()
    const { pulse: freshPulse } = await import('../../../../../src/api/common/helpers/pulse.js')

    expect(freshPulse.plugin).toBe(hapiPulse)
    expect(createLogger).toHaveBeenCalled()
    expect(pulse.options.logger).toBeDefined()
    expect(pulse.options.timeout).toBe(10000)
  })

  test('Should stop messaging before the server stops and close MongoDB after', () => {
    expect(pulse.options.preServerStop).toBe(stopMessaging)
    expect(pulse.options.postServerStop).toBe(closeDb)
  })

  test('Logger inside pulse should be a logger instance', () => {
    const loggerInstance = createLogger()
    expect(pulse.options.logger).toEqual(loggerInstance)
  })
})
