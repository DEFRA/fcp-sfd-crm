import { vi, describe, test, expect, beforeEach } from 'vitest'

import { config } from '../../../../../src/config/index.js'
import { createLogger } from '../../../../../src/logging/logger.js'

const mockCounter = vi.fn()
const mockGauge = vi.fn()
const mockMillis = vi.fn()

vi.mock('@defra/cdp-metrics', () => ({
  Metrics: vi.fn().mockImplementation(function () {
    return {
      counter: mockCounter,
      gauge: mockGauge,
      millis: mockMillis
    }
  })
}))

vi.mock('../../../../../src/logging/logger.js', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

const mockLogger = createLogger()

const { metricsCounter, metricsGauge, metricsMillis } = await import('../../../../../src/api/common/helpers/metrics.js')

const mockMetricsName = 'mock-metrics-name'
const defaultMetricsValue = 1
const mockValue = 200
const permittedDimensions = { reason: 'validation_failure' }
const forbiddenDimensions = { fileId: 'secret-file-id' }

describe('#metrics', () => {
  describe('When metrics is not enabled', () => {
    beforeEach(() => {
      config.set('isMetricsEnabled', false)
    })

    test('Should not call counter', () => {
      metricsCounter(mockMetricsName, mockValue)
      expect(mockCounter).not.toHaveBeenCalled()
    })

    test('Should not call gauge', () => {
      metricsGauge(mockMetricsName, mockValue)
      expect(mockGauge).not.toHaveBeenCalled()
    })

    test('Should not call millis', () => {
      metricsMillis(mockMetricsName, mockValue)
      expect(mockMillis).not.toHaveBeenCalled()
    })
  })

  describe('When metrics is enabled', () => {
    beforeEach(() => {
      config.set('isMetricsEnabled', true)
      mockCounter.mockReset()
      mockGauge.mockReset()
      mockMillis.mockReset()
    })

    test('Should send counter with default value', () => {
      metricsCounter(mockMetricsName)
      expect(mockCounter).toHaveBeenCalledWith(mockMetricsName, defaultMetricsValue, {})
    })

    test('Should send counter with explicit value', () => {
      metricsCounter(mockMetricsName, mockValue)
      expect(mockCounter).toHaveBeenCalledWith(mockMetricsName, mockValue, {})
    })

    test('Should send gauge', () => {
      metricsGauge(mockMetricsName, mockValue)
      expect(mockGauge).toHaveBeenCalledWith(mockMetricsName, mockValue, {})
    })

    test('Should send millis', () => {
      metricsMillis(mockMetricsName, mockValue)
      expect(mockMillis).toHaveBeenCalledWith(mockMetricsName, mockValue, {})
    })

    test('Should pass through a permitted dimension', () => {
      metricsCounter(mockMetricsName, mockValue, permittedDimensions)
      expect(mockCounter).toHaveBeenCalledWith(mockMetricsName, mockValue, permittedDimensions)
    })

    test('Should drop a forbidden dimension key and warn without its value', () => {
      metricsCounter(mockMetricsName, mockValue, forbiddenDimensions)

      expect(mockCounter).toHaveBeenCalledWith(mockMetricsName, mockValue, {})
      expect(mockLogger.warn).toHaveBeenCalledWith('Dropping unsupported metric dimension key: fileId')
      expect(mockLogger.warn).not.toHaveBeenCalledWith(expect.stringContaining('secret-file-id'))
    })
  })
})
