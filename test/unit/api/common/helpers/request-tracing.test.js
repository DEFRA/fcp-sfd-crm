import { describe, test, expect, vi } from 'vitest'
import { tracing } from '@defra/hapi-tracing'
import { config } from '../../../../../src/config/index.js'

vi.mock('@defra/hapi-tracing', () => ({
  tracing: {
    plugin: vi.fn()
  }
}))

const mockHeaderValue = 'x-trace-id'

vi.mock('../../../../../src/config/index.js', () => ({
  config: {
    get: vi.fn(() => mockHeaderValue)
  }
}))

const { requestTracing } = await import('../../../../../src/api/common/helpers/request-tracing.js')

describe('requestTracing plugin', () => {
  test('Should export expected plugin', () => {
    expect(requestTracing.plugin).toBe(tracing.plugin)
  })

  test('Should pass tracing header from config', () => {
    expect(requestTracing.options.tracingHeader).toBe(mockHeaderValue)
    expect(config.get).toHaveBeenCalledWith('tracing.header')
  })
})
