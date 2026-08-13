import { beforeEach, describe, test, expect, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getTraceId: vi.fn(),
  getCorrelationId: vi.fn()
}))

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
  getTraceId: mocks.getTraceId
}))

vi.mock('../../../src/logging/correlation-id-store.js', () => ({
  getCorrelationId: mocks.getCorrelationId
}))

const { loggerOptions } = await import('../../../src/logging/logger-options.js')

describe('loggerOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getTraceId.mockReturnValue(undefined)
    mocks.getCorrelationId.mockReturnValue(undefined)
  })

  test('should include trace id in mixin when getTraceId returns a value', () => {
    mocks.getTraceId.mockReturnValue('trace-123')

    const result = loggerOptions.mixin()

    expect(result).toEqual({ trace: { id: 'trace-123' } })
  })

  test('should return empty object when getTraceId returns null', () => {
    mocks.getTraceId.mockReturnValue(null)

    const result = loggerOptions.mixin()

    expect(result).toEqual({})
  })

  test('should include transaction.id as a flattened key when correlation context is active', () => {
    mocks.getCorrelationId.mockReturnValue('correlation-123')

    expect(loggerOptions.mixin()).toEqual({ 'transaction.id': 'correlation-123' })
  })

  test('should include trace and transaction IDs together', () => {
    mocks.getTraceId.mockReturnValue('trace-123')
    mocks.getCorrelationId.mockReturnValue('correlation-123')

    expect(loggerOptions.mixin()).toEqual({
      trace: { id: 'trace-123' },
      'transaction.id': 'correlation-123'
    })
  })
})
