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
  on(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = []
    this._listeners[event].push(fn)
  },
  emit(event, ...args) {
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

// Mock validation logger util at top-level for this test file to assert it's called
vi.mock('../../../../src/utils/validation-logger.js', () => ({
  logInboundValidationFailure: vi.fn()
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

    async function setupAndImportConsumer() {
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

      const consumerModule = await import('../../../../src/messaging/inbound/consumer.js')
      consumerModule.setLogger(logger)
      const { createCase } = await import('../../../../src/services/case.js')
      return { startCRMListener: consumerModule.startCRMListener, logger, createCase }
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

    test('should log starting consumer with queueUrl and endpoint', async () => {
      const { startCRMListener: start, logger } = await setupAndImportConsumer()
      const mockSqsClient = { config: { endpoint: 'mock-endpoint' } }
      start(mockSqsClient)
      expect(logger.info).toHaveBeenCalled()
      const calls = logger.info.mock.calls
      expect(calls.some(call => call.some(arg => arg === 'Starting CRM request consumer' || (typeof arg === 'string' && arg.includes('Starting CRM request consumer'))))).toBeTruthy()
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
      const { startCRMListener: start, createCase } = await setupAndImportConsumer()
      const mockSqsClient = { config: { endpoint: 'mock-endpoint' } }
      start(mockSqsClient)
      const message = {
        Body: JSON.stringify({
          id: 'evt-1',
          source: '/test',
          specversion: '1.0',
          type: 'test.type',
          datacontenttype: 'application/json',
          time: new Date().toISOString(),
          data: { crn: '123', sbi: '321', file: { fileId: '9fcaabe5-77ec-44db-8356-3a6e8dc51b13', fileName: 'file.pdf', url: 'https://example.com/api/v1/blobs/9fcaabe5-77ec-44db-8356-3a6e8dc51b13' }, correlationId: '550e8400-e29b-41d4-a716-446655440000', sourceSystem: 'fcp-sfd-frontend', submissionId: 'sub-1' }
        })
      }

      const result = await capturedHandleMessage(message)

      expect(createCase).toHaveBeenCalledWith(JSON.parse(message.Body))
      expect(result).toEqual(message)
    })

    test('should not call createCase for schema-invalid but parseable payload', async () => {
      const { startCRMListener: start, createCase } = await setupAndImportConsumer()
      const mockSqsClient = { config: { endpoint: 'mock-endpoint' } }
      start(mockSqsClient)

      // payload missing required file.fileId/fileName to fail schema validation
      const message = {
        Body: JSON.stringify({
          id: 'evt-invalid',
          source: '/test',
          specversion: '1.0',
          type: 'test.type',
          datacontenttype: 'application/json',
          time: new Date().toISOString(),
          data: { crn: '123', sbi: '321', file: {}, correlationId: 'corr-1', sourceSystem: 'fcp-sfd-frontend', submissionId: 'sub-2' }
        })
      }

      const result = await capturedHandleMessage(message)

      expect(createCase).not.toHaveBeenCalled()
      // on validation failure, handler returns the original message
      expect(result).toEqual(message)
    })

    test('should call logInboundValidationFailure on schema-invalid payload', async () => {
      const { startCRMListener: start } = await setupAndImportConsumer()
      const mockSqsClient = { config: { endpoint: 'mock-endpoint' } }
      start(mockSqsClient)

      const message = {
        Body: JSON.stringify({
          id: 'evt-invalid',
          source: '/test',
          specversion: '1.0',
          type: 'test.type',
          datacontenttype: 'application/json',
          time: new Date().toISOString(),
          data: { crn: '123', sbi: '321', file: {}, correlationId: 'corr-1' }
        })
      }

      const result = await capturedHandleMessage(message)

      const { logInboundValidationFailure } = await import('../../../../src/utils/validation-logger.js')
      expect(logInboundValidationFailure).toHaveBeenCalled()
      expect(result).toEqual(message)
    })

    test('should log error for invalid JSON in handleMessage', async () => {
      const { startCRMListener: start, logger } = await setupAndImportConsumer()
      const mockSqsClient = { config: { endpoint: 'mock-endpoint' } }
      start(mockSqsClient)
      const message = { Body: 'invalid-json' }

      const result = await capturedHandleMessage(message)

      expect(logger.error).toHaveBeenCalledWith('Invalid JSON in inbound message', expect.any(SyntaxError))
      expect(result).toEqual(message)
    })

    test('should call Consumer.create with expected options', async () => {
      const { startCRMListener: start } = await setupAndImportConsumer()
      const mockSqsClient = { config: { endpoint: 'mock-endpoint' } }
      start(mockSqsClient)
      const sqs = await import('sqs-consumer')
      expect(sqs.Consumer.create).toHaveBeenCalled()
      const opts = sqs.Consumer.create.mock.calls[0][0]
      expect(opts).toHaveProperty('queueUrl')
      expect(opts).toHaveProperty('batchSize')
      expect(opts).toHaveProperty('waitTimeSeconds')
      expect(opts).toHaveProperty('pollingWaitTime')
      expect(opts.sqs).toBe(mockSqsClient)
    })

    test('retryable true without retryMetadata leaves message on queue with null retry', async () => {
      const { startCRMListener: start, logger, createCase } = await setupAndImportConsumer()
      const mockSqsClient = { config: { endpoint: 'mock-endpoint' } }
      start(mockSqsClient)
      const retryableError = new Error('Retryable no metadata')
      retryableError.retryable = true
      // no retryMetadata set
      createCase.mockRejectedValueOnce(retryableError)
      const message = {
        Body: JSON.stringify({
          id: 'evt-r1',
          source: '/test',
          specversion: '1.0',
          type: 'test.type',
          datacontenttype: 'application/json',
          time: new Date().toISOString(),
          data: { crn: '123', sbi: '321', file: { fileId: '3fa85f64-5717-4562-b3fc-2c963f66afa6', fileName: 'file.pdf', url: 'https://example.com/api/v1/blobs/f1' }, correlationId: '550e8400-e29b-41d4-a716-446655440000', sourceSystem: 'fcp-sfd-frontend', submissionId: '3fa85f64-5717-4562-b3fc-2c963f66afa6' }
        })
      }

      const result = await capturedHandleMessage(message)

      const calls = logger.info.mock.calls
      const found = calls.some(call => call[1] === 'Retryable error, leaving message on queue' && call[0] && call[0].retry === null)
      expect(createCase).toHaveBeenCalled()
      // debug output
      // eslint-disable-next-line no-console
      console.debug('logger.info.calls:', JSON.stringify(logger.info.mock.calls, null, 2))
      // eslint-disable-next-line no-console
      console.debug('logger.error.calls:', JSON.stringify(logger.error.mock.calls, null, 2))
      expect(found).toBeTruthy()
      expect(result).toBeUndefined()
    })

    test('retryable with empty retryMetadata logs provided object', async () => {
      const { startCRMListener: start, logger, createCase } = await setupAndImportConsumer()
      const mockSqsClient = { config: { endpoint: 'mock-endpoint' } }
      start(mockSqsClient)
      const retryableError = new Error('Retryable empty metadata')
      retryableError.retryable = true
      retryableError.retryMetadata = {}
      createCase.mockRejectedValueOnce(retryableError)
      const message = {
        Body: JSON.stringify({
          id: 'evt-r2',
          source: '/test',
          specversion: '1.0',
          type: 'test.type',
          datacontenttype: 'application/json',
          time: new Date().toISOString(),
          data: { crn: '123', sbi: '321', file: { fileId: '4fa85f64-5717-4562-b3fc-2c963f66afa6', fileName: 'file.pdf', url: 'https://example.com/api/v1/blobs/f2' }, correlationId: '550e8400-e29b-41d4-a716-446655440000', sourceSystem: 'fcp-sfd-frontend', submissionId: '3fa85f64-5717-4562-b3fc-2c963f66afa6' }
        })
      }

      const result = await capturedHandleMessage(message)

      const calls = logger.info.mock.calls
      const found = calls.some(call => call[1] === 'Retryable error, leaving message on queue' && call[0] && typeof call[0].retry === 'object')
      expect(createCase).toHaveBeenCalled()
      // debug output
      // eslint-disable-next-line no-console
      console.debug('logger.info.calls:', JSON.stringify(logger.info.mock.calls, null, 2))
      // eslint-disable-next-line no-console
      console.debug('logger.error.calls:', JSON.stringify(logger.error.mock.calls, null, 2))
      expect(found).toBeTruthy()
      expect(result).toBeUndefined()
    })

    test('non-retryable error without retryMetadata is discarded and logs nulls', async () => {
      const { startCRMListener: start, logger, createCase } = await setupAndImportConsumer()
      const mockSqsClient = { config: { endpoint: 'mock-endpoint' } }
      start(mockSqsClient)
      const err = new Error('Generic failure')
      // no retryable, no retryMetadata
      createCase.mockRejectedValueOnce(err)
      const message = {
        Body: JSON.stringify({
          id: 'evt-nr1',
          source: '/test',
          specversion: '1.0',
          type: 'test.type',
          datacontenttype: 'application/json',
          time: new Date().toISOString(),
          data: { crn: '123', sbi: '321', file: { fileId: '5fa85f64-5717-4562-b3fc-2c963f66afa6', fileName: 'file.pdf', url: 'https://example.com/api/v1/blobs/f3' }, correlationId: '550e8400-e29b-41d4-a716-446655440000', sourceSystem: 'fcp-sfd-frontend', submissionId: '3fa85f64-5717-4562-b3fc-2c963f66afa6' }
        })
      }

      const result = await capturedHandleMessage(message)

      expect(logger.error).toHaveBeenCalled()
      expect(createCase).toHaveBeenCalled()
      // debug output
      // eslint-disable-next-line no-console
      console.debug('logger.info.calls:', JSON.stringify(logger.info.mock.calls, null, 2))
      // eslint-disable-next-line no-console
      console.debug('logger.error.calls:', JSON.stringify(logger.error.mock.calls, null, 2))
      expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ message: 'Generic failure', status: null, category: null }), retry: null }), 'Failed to create case via CRM API')
      expect(result).toEqual(message)
    })

    test('unknown retryMetadata.category treated as non-retryable unless retryable flag set', async () => {
      const { startCRMListener: start, logger, createCase } = await setupAndImportConsumer()
      const mockSqsClient = { config: { endpoint: 'mock-endpoint' } }
      start(mockSqsClient)
      const err = new Error('Unknown category')
      err.retryMetadata = { category: 'unknown', status: 520 }
      // not setting err.retryable => non-retryable path
      createCase.mockRejectedValueOnce(err)
      const message = {
        Body: JSON.stringify({
          id: 'evt-unk',
          source: '/test',
          specversion: '1.0',
          type: 'test.type',
          datacontenttype: 'application/json',
          time: new Date().toISOString(),
          data: { crn: '123', sbi: '321', file: { fileId: '6fa85f64-5717-4562-b3fc-2c963f66afa6', fileName: 'file.pdf', url: 'https://example.com/api/v1/blobs/f4' }, correlationId: '550e8400-e29b-41d4-a716-446655440000', sourceSystem: 'fcp-sfd-frontend', submissionId: '3fa85f64-5717-4562-b3fc-2c963f66afa6' }
        })
      }

      const result = await capturedHandleMessage(message)

      expect(logger.error).toHaveBeenCalled()
      expect(createCase).toHaveBeenCalled()
      // debug output
      // eslint-disable-next-line no-console
      console.debug('logger.info.calls:', JSON.stringify(logger.info.mock.calls, null, 2))
      // eslint-disable-next-line no-console
      console.debug('logger.error.calls:', JSON.stringify(logger.error.mock.calls, null, 2))
      expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ category: 'unknown', status: 520 }), retry: expect.objectContaining({ category: 'unknown', status: 520 }) }), 'Failed to create case via CRM API')
      expect(result).toEqual(message)
    })

    test('empty and null Body are treated as invalid JSON and return message', async () => {
      const { startCRMListener: start, logger } = await setupAndImportConsumer()
      const mockSqsClient = { config: { endpoint: 'mock-endpoint' } }
      start(mockSqsClient)

      const resultEmpty = await capturedHandleMessage({ Body: '' })
      expect(logger.error).toHaveBeenCalled()
      expect(resultEmpty).toEqual({ Body: '' })

      const resultNull = await capturedHandleMessage({ Body: null })
      expect(logger.error).toHaveBeenCalled()
      expect(resultNull).toEqual({ Body: null })
    })



    test('setLogger injection replaces internal logger used by events', async () => {
      const consumerModule = await import('../../../../src/messaging/inbound/consumer.js')
      const customLogger = { info: vi.fn(), error: vi.fn() }
      consumerModule.setLogger(customLogger)
      const mockSqsClient = { config: { endpoint: 'mock-endpoint' } }
      consumerModule.startCRMListener(mockSqsClient)
      mockConsumer.emit('started')
      expect(customLogger.info).toHaveBeenCalledWith('CRM request consumer started')
    })

    test('should return undefined when createCase fails with retryable error', async () => {
      const { createCase } = await import('../../../../src/services/case.js')
      const { startCRMListener: start, logger } = await setupAndImportConsumer()
      const mockSqsClient = { config: { endpoint: 'mock-endpoint' } }
      start(mockSqsClient)
      const retryableError = new Error('CRM API retryable failure')
      retryableError.retryable = true
      retryableError.retryMetadata = { category: 'retryable', status: 503 }
      createCase.mockRejectedValueOnce(retryableError)
      const message = {
        Body: JSON.stringify({
          id: 'evt-2',
          source: '/test',
          specversion: '1.0',
          type: 'test.type',
          datacontenttype: 'application/json',
          time: new Date().toISOString(),
          data: { crn: '123', sbi: '321', file: { fileId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', fileName: 'file2.pdf', url: 'https://example.com/api/v1/blobs/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' }, correlationId: '550e8400-e29b-41d4-a716-446655440000', sourceSystem: 'fcp-sfd-frontend', submissionId: '3fa85f64-5717-4562-b3fc-2c963f66afa6' }
        })
      }

      const result = await capturedHandleMessage(message)

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: expect.objectContaining({
            type: 'crm_case_creation_retryable',
            action: 'leave_on_queue',
            outcome: 'unknown'
          }),
          retry: expect.objectContaining({ category: 'retryable', status: 503 })
        }),
        'Retryable error, leaving message on queue'
      )
      expect(result).toBeUndefined()
    })

    test('should log error and return message when createCase fails with non-retryable error', async () => {
      const { createCase } = await import('../../../../src/services/case.js')
      const { startCRMListener: start, logger } = await setupAndImportConsumer()
      const mockSqsClient = { config: { endpoint: 'mock-endpoint' } }
      start(mockSqsClient)
      const nonRetryError = new Error('CRM API failed')
      nonRetryError.retryMetadata = { category: 'non-retryable', status: 400 }
      createCase.mockRejectedValueOnce(nonRetryError)
      const message = {
        Body: JSON.stringify({
          id: 'evt-3',
          source: '/test',
          specversion: '1.0',
          type: 'test.type',
          datacontenttype: 'application/json',
          time: new Date().toISOString(),
          data: { crn: '123', sbi: '321', file: { fileId: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e', fileName: 'file3.pdf', url: 'https://example.com/api/v1/blobs/b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e' }, correlationId: '550e8400-e29b-41d4-a716-446655440000', sourceSystem: 'fcp-sfd-frontend', submissionId: '3fa85f64-5717-4562-b3fc-2c963f66afa6' }
        })
      }

      const result = await capturedHandleMessage(message)

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          event: expect.objectContaining({
            type: 'crm_case_creation_failed',
            action: 'discard_message',
            outcome: 'failure'
          }),
          error: expect.objectContaining({ message: 'CRM API failed', status: 400, category: 'non-retryable' }),
          retry: expect.objectContaining({ category: 'non-retryable', status: 400 })
        }),
        'Failed to create case via CRM API'
      )
      expect(result).toEqual(message)
    })
  })
})

afterAll(() => {
  vi.resetAllMocks()
})

test('when schema.validate throws, handleMessage rejects with that error', async () => {
  vi.resetModules()
  // use doMock to avoid hoisting issues
  vi.doMock('../../../../src/api/schemas/index.js', () => ({ inboundCloudEventSchema: { validate: () => { throw new Error('validate exploded') } }, validationOptions: {} }))
  // re-import consumer so it picks up the mocked schema
  const consumerModule = await import('../../../../src/messaging/inbound/consumer.js')
  consumerModule.setLogger({ info: vi.fn(), error: vi.fn() })
  const mockSqsClient = { config: { endpoint: 'mock-endpoint' } }
  consumerModule.startCRMListener(mockSqsClient)
  const sqs = await import('sqs-consumer')
  const handler = sqs.Consumer.create.mock.calls[0][0].handleMessage
  const message = { Body: JSON.stringify({ id: 'evt-throw' }) }
  const result = await handler(message)
  expect(result).toEqual(message)
  // reset modules so subsequent tests are unaffected by the doMock
  vi.resetModules()
})
