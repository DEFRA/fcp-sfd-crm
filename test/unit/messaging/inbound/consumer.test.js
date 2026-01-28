import { vi, describe, test, expect, beforeEach, afterAll } from 'vitest'

import * as sqsConsumer from 'sqs-consumer'

import { createLogger } from '../../../../../src/logging/logger.js'
import { startCommsListener, stopCommsListener } from '../../../../../src/messaging/inbound/consumer.js'

vi.mock('../../../../../src/logging/logger.js', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn()
  })
}))

let mockConsumer

const consumerSpy = vi.spyOn(sqsConsumer.Consumer, 'create').mockImplementation((config) => {
  mockConsumer = new sqsConsumer.Consumer(config)

  mockConsumer.start = vi.fn()
  mockConsumer.stop = vi.fn()

  return mockConsumer
})

const mockLogger = createLogger()

describe('CRM request sqs consumer', () => {
  test('should start the consumer', () => {
    startCommsListener({})

    expect(mockConsumer.start).toHaveBeenCalled()
  })

  test('should stop the consumer', () => {
    stopCommsListener({})

    expect(mockConsumer.stop).toHaveBeenCalled()
  })

  describe('event listeners', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    test('should log consumer start', () => {
      mockConsumer.emit('started')

      expect(mockLogger.info).toHaveBeenCalledWith('Comms request consumer started')
    })

    test('should log consumer stop', () => {
      mockConsumer.emit('stopped')

      expect(mockLogger.info).toHaveBeenCalledWith('Comms request consumer stopped')
    })

    test('should log consumer error', () => {
      const mockError = new Error('Consumer error')

      mockConsumer.emit('error', mockError)

      expect(mockLogger.error).toHaveBeenCalledWith(
        mockError,
        'Unhandled SQS error in comms request consumer'
      )
    })

    test('should log consumer processing_error', () => {
      const mockError = new Error('Consumer error')

      mockConsumer.emit('processing_error', mockError)

      expect(mockLogger.error).toHaveBeenCalledWith(
        mockError,
        'Unhandled error during comms request message processing'
      )
    })

    test('should log consumer timeout_error', () => {
      const mockError = new Error('Consumer error')

      mockConsumer.emit('timeout_error', mockError)

      expect(mockLogger.error).toHaveBeenCalledWith(
        mockError,
        'Comms request processing has reached configured timeout'
      )
    })
  })

  afterAll(() => {
    consumerSpy.mockRestore()
  })
})
