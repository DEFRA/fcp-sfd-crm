import { describe, test, expect, vi, beforeEach } from 'vitest'

const mockSend = vi.fn()
vi.mock('../../../../src/messaging/sqs/client.js', () => ({
  sqsClient: { send: (...args) => mockSend(...args) }
}))

const mockLogger = { info: vi.fn(), error: vi.fn() }

vi.mock('../../../../src/services/case.js', () => ({
  createCase: vi.fn()
}))

vi.mock('../../../../src/logging/logger.js', () => ({
  createLogger: () => mockLogger
}))

vi.mock('../../../../src/data/db.js', () => ({
  default: {
    collection: () => ({
      createIndex: vi.fn().mockResolvedValue(),
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockResolvedValue({ acknowledged: true })
    })
  }
}))

const { pollInboundMessages } = await import('../../../../src/messaging/inbound/poll-inbound-messages.js')
const { createCase } = await import('../../../../src/services/case.js')

describe('pollInboundMessages', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv, CRM_QUEUE_URL: 'https://queue-url' }
  })

  test('should return early when no messages', async () => {
    mockSend.mockResolvedValue({ Messages: null })

    await pollInboundMessages(() => Promise.resolve())

    expect(createCase).not.toHaveBeenCalled()
  })

  test('should process messages and create case', async () => {
    const payload = { data: { correlationId: 'corr-1', crn: 'crn1' } }
    mockSend
      .mockResolvedValueOnce({
        Messages: [{ Body: JSON.stringify(payload), ReceiptHandle: 'handle-1' }]
      })
      .mockResolvedValue({})

    createCase.mockResolvedValue({ caseId: 'case-1' })

    await pollInboundMessages(() => Promise.resolve())

    expect(createCase).toHaveBeenCalledWith(payload)
  })

  test('should delete invalid JSON messages and continue', async () => {
    mockSend
      .mockResolvedValueOnce({
        Messages: [
          { Body: 'invalid-json', ReceiptHandle: 'handle-1' },
          { Body: JSON.stringify({ data: { correlationId: 'corr-2' } }), ReceiptHandle: 'handle-2' }
        ]
      })
      .mockResolvedValue({})

    createCase.mockResolvedValue({})

    await pollInboundMessages(() => Promise.resolve())

    expect(createCase).toHaveBeenCalledTimes(1)
  })

  test('should log error and delete message when createCase fails', async () => {
    mockSend
      .mockResolvedValueOnce({
        Messages: [{ Body: JSON.stringify({ data: { correlationId: 'corr-1' } }), ReceiptHandle: 'handle-1' }]
      })
      .mockResolvedValue({})

    createCase.mockRejectedValue(new Error('CRM API failed'))

    await pollInboundMessages(() => Promise.resolve())

    expect(mockLogger.error).toHaveBeenCalledWith('Failed to create case via CRM API', expect.any(Error))
  })
})
