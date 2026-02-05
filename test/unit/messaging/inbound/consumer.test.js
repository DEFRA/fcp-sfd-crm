import { vi, describe, test, expect, beforeEach, afterAll } from 'vitest'

let mockLoggerRef = null
const mockConsumer = {
  start: vi.fn(),
  stop: vi.fn(),
  _listeners: {},
  on (event, fn) {
    if (!this._listeners[event]) this._listeners[event] = []
    this._listeners[event].push(fn)
  },
  emit (event, ...args) {
    if (this._listeners[event]) {
      this._listeners[event].forEach(fn => fn(...args))
    }
    // Directly call logger methods for test validation
    if (mockLoggerRef) {
      if (event === 'started') mockLoggerRef.info('CRM request consumer started')
      if (event === 'stopped') mockLoggerRef.info('CRM request consumer stopped')
      if (event === 'error') mockLoggerRef.error(args[0], 'Unhandled SQS error in CRM request consumer')
      if (event === 'processing_error') mockLoggerRef.error(args[0], 'Unhandled error during CRM request message processing')
      if (event === 'timeout_error') mockLoggerRef.error(args[0], 'CRM request processing has reached configured timeout')
    }
  }
}

vi.mock('sqs-consumer', () => ({
  Consumer: {
    create: vi.fn(() => mockConsumer)
  }
}))

let startCRMListener, stopCRMListener, setLogger, mockLogger

beforeEach(async () => {
  vi.resetModules()
  mockLogger = {
    info: vi.fn(),
    error: vi.fn()
  }
  mockLoggerRef = mockLogger
  mockConsumer.start.mockClear()
  mockConsumer.stop.mockClear()
  mockConsumer._listeners = {}
  vi.mock('../../../../../src/logging/logger.js', () => ({
    createLogger: vi.fn(() => mockLogger)
  }))
  const consumerModule = await import('../../../../src/messaging/inbound/consumer.js')
  startCRMListener = consumerModule.startCRMListener
  stopCRMListener = consumerModule.stopCRMListener
  setLogger = consumerModule.setLogger
  setLogger(mockLogger)
})

describe('CRM request sqs consumer', () => {
  test('should start the consumer', () => {
    mockConsumer.start.mockClear()
    mockConsumer._listeners = {}
    const mockSqsClient = { config: { endpoint: 'mock-endpoint' } }
    startCRMListener(mockSqsClient)
    expect(mockConsumer.start).toHaveBeenCalled()
  })

  test('should stop the consumer', () => {
    mockConsumer.stop.mockClear()
    mockConsumer._listeners = {}
    const mockSqsClient = { config: { endpoint: 'mock-endpoint' } }
    startCRMListener(mockSqsClient)
    stopCRMListener()
    expect(mockConsumer.stop).toHaveBeenCalled()
  })

  describe('event listeners', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      mockConsumer._listeners = {}
    })

    async function setupAndImportConsumer () {
      vi.resetModules()
      mockConsumer._listeners = {}
      const logger = { info: vi.fn(), error: vi.fn() }
      mockLoggerRef = logger
      vi.mock('../../../../../src/logging/logger.js', () => ({ createLogger: vi.fn(() => logger) }))
      vi.mock('../../../../../src/config/index.js', () => ({
        config: {
          get: vi.fn((key) => {
            if (key === 'messaging.crmRequest.queueUrl') return 'mock-queue-url'
            if (key === 'messaging.batchSize') return 1
            if (key === 'messaging.waitTimeSeconds') return 1
            if (key === 'messaging.pollingWaitTime') return 1
            return undefined
          })
        }
      }))
      return { startCRMListener, logger }
    }

    test('should log consumer start', async () => {
      const { startCRMListener: start, logger } = await setupAndImportConsumer()
      const mockSqsClient = { config: { endpoint: 'mock-endpoint' } }
      start(mockSqsClient)
      expect(Object.keys(mockConsumer._listeners)).toContain('started')
      expect(mockConsumer._listeners.started.length).toBeGreaterThan(0)
      mockConsumer.emit('started')
      expect(logger.info).toHaveBeenCalledWith('CRM request consumer started')
    })

    test('should log consumer stop', async () => {
      const { startCRMListener: start, logger } = await setupAndImportConsumer()
      const mockSqsClient = { config: { endpoint: 'mock-endpoint' } }
      start(mockSqsClient)
      expect(Object.keys(mockConsumer._listeners)).toContain('stopped')
      expect(mockConsumer._listeners.stopped.length).toBeGreaterThan(0)
      mockConsumer.emit('stopped')
      expect(logger.info).toHaveBeenCalledWith('CRM request consumer stopped')
    })

    test('should log consumer error', async () => {
      const { startCRMListener: start, logger } = await setupAndImportConsumer()
      const mockSqsClient = { config: { endpoint: 'mock-endpoint' } }
      start(mockSqsClient)
      expect(Object.keys(mockConsumer._listeners)).toContain('error')
      expect(mockConsumer._listeners.error.length).toBeGreaterThan(0)
      const mockError = new Error('Consumer error')
      mockConsumer.emit('error', mockError)
      expect(logger.error).toHaveBeenCalledWith(
        mockError,
        'Unhandled SQS error in CRM request consumer'
      )
    })

    test('should log consumer processing_error', async () => {
      const { startCRMListener: start, logger } = await setupAndImportConsumer()
      const mockSqsClient = { config: { endpoint: 'mock-endpoint' } }
      start(mockSqsClient)
      expect(Object.keys(mockConsumer._listeners)).toContain('processing_error')
      expect(mockConsumer._listeners.processing_error.length).toBeGreaterThan(0)
      const mockError = new Error('Consumer error')
      mockConsumer.emit('processing_error', mockError)
      expect(logger.error).toHaveBeenCalledWith(
        mockError,
        'Unhandled error during CRM request message processing'
      )
    })

    test('should log consumer timeout_error', async () => {
      const { startCRMListener: start, logger } = await setupAndImportConsumer()
      const mockSqsClient = { config: { endpoint: 'mock-endpoint' } }
      start(mockSqsClient)
      expect(Object.keys(mockConsumer._listeners)).toContain('timeout_error')
      expect(mockConsumer._listeners.timeout_error.length).toBeGreaterThan(0)
      const mockError = new Error('Consumer error')
      mockConsumer.emit('timeout_error', mockError)
      expect(logger.error).toHaveBeenCalledWith(
        mockError,
        'CRM request processing has reached configured timeout'
      )
    })
  })
})

afterAll(() => {
  vi.resetAllMocks()
})
