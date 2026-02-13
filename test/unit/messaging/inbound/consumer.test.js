import { vi, describe, test, expect, beforeEach, afterAll } from 'vitest'

vi.mock('../../../../src/data/db.js', () => ({
  default: {
    collection: () => ({
      createIndex: vi.fn().mockResolvedValue(),
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockResolvedValue({ acknowledged: true })
    })
  }
}))

vi.mock('../../../../src/services/case.js', () => ({
  createCase: vi.fn()
}))

let mockLoggerRef = null
let capturedHandleMessage = null
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
    create: vi.fn((opts) => {
      capturedHandleMessage = opts.handleMessage
      return mockConsumer
    })
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
  capturedHandleMessage = null
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

    test('should call createCase when handleMessage receives valid JSON', async () => {
      const { createCase } = await import('../../../../src/services/case.js')
      const { startCRMListener: start } = await setupAndImportConsumer()
      const mockSqsClient = { config: { endpoint: 'mock-endpoint' } }
      start(mockSqsClient)

      await capturedHandleMessage({ Body: JSON.stringify({ data: { correlationId: 'corr-1' } }) })

      expect(createCase).toHaveBeenCalledWith({ data: { correlationId: 'corr-1' } })
    })

    test('should log error for invalid JSON in handleMessage', async () => {
      const { startCRMListener: start } = await setupAndImportConsumer()
      const mockSqsClient = { config: { endpoint: 'mock-endpoint' } }
      start(mockSqsClient)

      await capturedHandleMessage({ Body: 'invalid-json' })

      expect(mockLogger.error).toHaveBeenCalledWith('Invalid JSON in inbound message', expect.any(SyntaxError))
    })

    test('should log error when createCase fails in handleMessage', async () => {
      const { createCase } = await import('../../../../src/services/case.js')
      const { startCRMListener: start } = await setupAndImportConsumer()
      const mockSqsClient = { config: { endpoint: 'mock-endpoint' } }
      start(mockSqsClient)
      createCase.mockRejectedValueOnce(new Error('CRM API failed'))

      await capturedHandleMessage({ Body: JSON.stringify({ data: { correlationId: 'corr-1' } }) })

      expect(mockLogger.error).toHaveBeenCalledWith('Failed to create case via CRM API', expect.any(Error))
    })
  })
})

afterAll(() => {
  vi.resetAllMocks()
})
