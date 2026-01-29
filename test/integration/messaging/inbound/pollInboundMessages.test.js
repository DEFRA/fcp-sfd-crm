import { describe, test, expect, vi, beforeEach } from 'vitest'

const mockLogger = { info: vi.fn(), error: vi.fn() }

// Mock logger
vi.mock('../../../../src/logging/logger.js', () => ({
  createLogger: () => mockLogger
}))

// Mock caseService
const mockCreateCase = vi.fn()
vi.mock('../../../../src/services/caseService.js', () => ({
  createCase: mockCreateCase
}))
// Mock AWS SDK v3 SQS client
vi.mock('@aws-sdk/client-sqs', () => ({
  ReceiveMessageCommand: class { constructor(params) { this.params = params } },
  DeleteMessageCommand: class { constructor(params) { this.params = params } }
}))

const mockSend = vi.fn()
vi.mock('../../../../src/messaging/sqs/client.js', () => ({
  sqsClient: { send: mockSend }
}))

const { pollInboundMessages } = await import('../../../../src/messaging/inbound/index.js')

describe('pollInboundMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSend.mockReset()
  })

  test('processes messages successfully and deletes them', async () => {
    mockSend
      .mockResolvedValueOnce({
        Messages: [
          { Body: JSON.stringify({ caseId: '1', subject: 'A', details: {} }), ReceiptHandle: 'rh-1' },
          { Body: JSON.stringify({ caseId: '2', subject: 'B', details: {} }), ReceiptHandle: 'rh-2' }
        ]
      })
      .mockResolvedValue({}) // for DeleteMessageCommand

    await pollInboundMessages(() => { })

    expect(mockCreateCase).toHaveBeenCalledTimes(2)
    expect(mockCreateCase).toHaveBeenCalledWith({ caseId: '1', subject: 'A', details: {} })
    expect(mockCreateCase).toHaveBeenCalledWith({ caseId: '2', subject: 'B', details: {} })

    // There should be two delete calls
    const deleteCalls = mockSend.mock.calls.filter(([cmd]) => cmd.constructor.name === 'DeleteMessageCommand')
    expect(deleteCalls.length).toBe(2)
    expect(deleteCalls[0][0].params.ReceiptHandle).toBe('rh-1')
    expect(deleteCalls[1][0].params.ReceiptHandle).toBe('rh-2')
  })

  test('logs errors on invalid JSON but continues processing', async () => {
    mockSend
      .mockResolvedValueOnce({
        Messages: [
          { Body: 'invalid-json', ReceiptHandle: 'rh-1' },
          { Body: JSON.stringify({ caseId: '3', subject: 'C', details: {} }), ReceiptHandle: 'rh-2' }
        ]
      })
      .mockResolvedValue({}) // for DeleteMessageCommand

    await pollInboundMessages(() => { })

    expect(mockCreateCase).toHaveBeenCalledTimes(1)
    expect(mockCreateCase).toHaveBeenCalledWith({ caseId: '3', subject: 'C', details: {} })

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Invalid JSON in inbound message',
      expect.any(SyntaxError)
    )

    // There should be two delete calls
    const deleteCalls = mockSend.mock.calls.filter(([cmd]) => cmd.constructor.name === 'DeleteMessageCommand')
    expect(deleteCalls.length).toBe(2)
  })

  test('logs errors from createCase but continues processing', async () => {
    mockSend
      .mockResolvedValueOnce({
        Messages: [
          { Body: JSON.stringify({ caseId: '4', subject: 'D', details: {} }), ReceiptHandle: 'rh-4' }
        ]
      })
      .mockResolvedValue({}) // for DeleteMessageCommand

    const error = new Error('CRM API failed')
    mockCreateCase.mockRejectedValue(error)

    await pollInboundMessages(() => { })

    expect(mockCreateCase).toHaveBeenCalledTimes(1)
    expect(mockLogger.error).toHaveBeenCalledWith('Failed to create case via CRM API', error)
    // There should be one delete call
    const deleteCalls = mockSend.mock.calls.filter(([cmd]) => cmd.constructor.name === 'DeleteMessageCommand')
    expect(deleteCalls.length).toBe(1)
  })
})
