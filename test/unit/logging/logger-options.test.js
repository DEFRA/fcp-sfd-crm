import { describe, test, expect, vi } from 'vitest'

vi.mock('../../../src/config/index.js', () => ({
  config: {
    get: vi.fn((key) => {
      if (key === 'log') return { isEnabled: true, redact: [], level: 'info', format: 'pino-pretty' }
      if (key === 'serviceName') return 'test-service'
      if (key === 'serviceVersion') return '1.0.0'
      return undefined
    })
  }
}))

vi.mock('@defra/hapi-tracing', () => ({
  getTraceId: vi.fn()
}))

const { getTraceId } = await import('@defra/hapi-tracing')
const { loggerOptions } = await import('../../../src/logging/logger-options.js')

describe('loggerOptions', () => {
  test('should include trace id in mixin when getTraceId returns a value', () => {
    getTraceId.mockReturnValue('trace-123')

    const result = loggerOptions.mixin()

    expect(result).toEqual({ trace: { id: 'trace-123' } })
  })

  test('should return empty object when getTraceId returns null', () => {
    getTraceId.mockReturnValue(null)

    const result = loggerOptions.mixin()

    expect(result).toEqual({})
  })
})
