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
const forbiddenKeyDimensions = { fileId: 'secret-file-id' }
const forbiddenValueDimensions = { reason: 'secret-correlation-id-12345' }
const mixedDimensions = { reason: 'validation_failure', fileId: 'secret-file-id' }

describe('#metrics', () => {
  describe('When metrics is not enabled', () => {
    beforeEach(() => {
      config.set('isMetricsEnabled', false)
    })

    test('Should not call counter', async () => {
      await metricsCounter(mockMetricsName, mockValue)
      expect(mockCounter).not.toHaveBeenCalled()
    })

    test('Should not call gauge', async () => {
      await metricsGauge(mockMetricsName, mockValue)
      expect(mockGauge).not.toHaveBeenCalled()
    })

    test('Should not call millis', async () => {
      await metricsMillis(mockMetricsName, mockValue)
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

    test('Should send counter with default value', async () => {
      await metricsCounter(mockMetricsName)
      expect(mockCounter).toHaveBeenCalledWith(mockMetricsName, defaultMetricsValue, {})
    })

    test('Should send counter with explicit value', async () => {
      await metricsCounter(mockMetricsName, mockValue)
      expect(mockCounter).toHaveBeenCalledWith(mockMetricsName, mockValue, {})
    })

    test('Should send gauge', async () => {
      await metricsGauge(mockMetricsName, mockValue)
      expect(mockGauge).toHaveBeenCalledWith(mockMetricsName, mockValue, {})
    })

    test('Should send millis', async () => {
      await metricsMillis(mockMetricsName, mockValue)
      expect(mockMillis).toHaveBeenCalledWith(mockMetricsName, mockValue, {})
    })

    test('Should pass through a permitted dimension', async () => {
      await metricsCounter(mockMetricsName, mockValue, permittedDimensions)
      expect(mockCounter).toHaveBeenCalledWith(mockMetricsName, mockValue, permittedDimensions)
    })

    test('Should drop a forbidden dimension key and warn without its value', async () => {
      await metricsCounter(mockMetricsName, mockValue, forbiddenKeyDimensions)

      expect(mockCounter).toHaveBeenCalledWith(mockMetricsName, mockValue, {})
      expect(mockLogger.warn).toHaveBeenCalledWith('Dropping unsupported metric dimension key: fileId')
      expect(mockLogger.warn).not.toHaveBeenCalledWith(expect.stringContaining('secret-file-id'))
    })

    test('Should drop a value outside the allowed set for a permitted key, without logging it', async () => {
      await metricsCounter(mockMetricsName, mockValue, forbiddenValueDimensions)

      expect(mockCounter).toHaveBeenCalledWith(mockMetricsName, mockValue, {})
      expect(mockLogger.warn).toHaveBeenCalledWith('Dropping unsupported metric dimension value for key: reason')
      expect(mockLogger.warn).not.toHaveBeenCalledWith(expect.stringContaining('secret-correlation-id-12345'))
    })

    test('Should keep a permitted key and drop a forbidden key from the same call', async () => {
      await metricsCounter(mockMetricsName, mockValue, mixedDimensions)
      expect(mockCounter).toHaveBeenCalledWith(mockMetricsName, mockValue, { reason: 'validation_failure' })
    })

    test('Should treat null dimensions as empty rather than throwing', async () => {
      await expect(metricsCounter(mockMetricsName, mockValue, null)).resolves.toBeUndefined()
      expect(mockCounter).toHaveBeenCalledWith(mockMetricsName, mockValue, {})
    })

    test('Should not throw or reject when the library rejects', async () => {
      const mockError = new Error('mock-metrics-put-error')
      mockCounter.mockRejectedValueOnce(mockError)

      await expect(metricsCounter(mockMetricsName, mockValue)).resolves.toBeUndefined()
      expect(mockLogger.warn).toHaveBeenCalledWith(mockError, mockError.message)
    })
  })
})
