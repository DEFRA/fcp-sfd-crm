import { describe, test, expect, vi, beforeEach } from 'vitest'

const mockLogger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() }

vi.mock('../../../../src/logging/logger.js', () => ({
  createLogger: vi.fn().mockReturnValue(mockLogger)
}))

vi.mock('../../../../src/messaging/sns/publish.js', () => ({
  publish: vi.fn()
}))

vi.mock('../../../../src/messaging/sqs/client.js', () => ({
  sqsClient: {}
}))

vi.mock('../../../../src/messaging/sqs/send-to-dlq.js', () => ({
  sendToDlq: vi.fn()
}))

vi.mock('../../../../src/config/index.js', () => ({
  config: {
    get: vi.fn((key) => {
      const values = {
        'messaging.crmEvents.publishRetry.maxAttempts': 3,
        'messaging.crmEvents.publishRetry.baseDelayMs': 10,
        'messaging.crmEvents.publishRetry.backoffMultiplier': 2,
        'messaging.crmEvents.publishRetry.jitterPercentage': 0,
        'messaging.crmEvents.publishDlqUrl': 'https://publish-dlq-url'
      }
      return values[key]
    })
  }
}))

const { publish } = await import('../../../../src/messaging/sns/publish.js')
const { sendToDlq } = await import('../../../../src/messaging/sqs/send-to-dlq.js')
const { publishWithDurability } = await import('../../../../src/messaging/outbound/publish-retry.js')

const mockSnsClient = {}
const topicArn = 'arn:aws:sns:eu-west-2:123:fcp_sfd_crm_events'
const payload = { type: 'uk.gov.fcp.sfd.crm.case.created', data: { caseId: 'case-1' } }
const context = { caseId: 'case-1', correlationId: 'corr-1' }

describe('publishWithDurability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  test('resolves without retrying when publish succeeds on first attempt', async () => {
    publish.mockResolvedValue()

    const promise = publishWithDurability(mockSnsClient, topicArn, payload, context)
    await vi.runAllTimersAsync()
    await promise

    expect(publish).toHaveBeenCalledTimes(1)
    expect(sendToDlq).not.toHaveBeenCalled()
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  test('retries and resolves when publish fails once then succeeds', async () => {
    publish
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue()

    const promise = publishWithDurability(mockSnsClient, topicArn, payload, context)
    await vi.runAllTimersAsync()
    await promise

    expect(publish).toHaveBeenCalledTimes(2)
    expect(sendToDlq).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalledTimes(1)
  })

  test('calls sendToDlq with correct envelope after all retries exhausted', async () => {
    const publishErr = new Error('SNS down')
    publishErr.name = 'ServiceUnavailableError'
    publish.mockRejectedValue(publishErr)
    sendToDlq.mockResolvedValue()

    const promise = publishWithDurability(mockSnsClient, topicArn, payload, context)
    await vi.runAllTimersAsync()
    await promise

    expect(publish).toHaveBeenCalledTimes(3)
    expect(sendToDlq).toHaveBeenCalledTimes(1)

    const [, , envelope] = sendToDlq.mock.calls[0]
    expect(envelope.originalPayload).toBe(payload)
    expect(envelope.metadata).toMatchObject({
      caseId: 'case-1',
      correlationId: 'corr-1',
      topicArn,
      errorMessage: 'SNS down',
      errorName: 'ServiceUnavailableError',
      totalAttempts: 3,
      source: 'fcp-sfd-crm'
    })
    expect(envelope.metadata.failedAt).toBeDefined()
  })

  test('logs CRITICAL and does not throw when DLQ send also fails', async () => {
    publish.mockRejectedValue(new Error('SNS down'))
    sendToDlq.mockRejectedValue(new Error('SQS also down'))

    const promise = publishWithDurability(mockSnsClient, topicArn, payload, context)
    await vi.runAllTimersAsync()
    await expect(promise).resolves.toBeUndefined()

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: 'case-1', correlationId: 'corr-1' }),
      expect.stringContaining('CRITICAL')
    )
  })

  test('never throws even when both SNS publish and DLQ fail', async () => {
    publish.mockRejectedValue(new Error('SNS down'))
    sendToDlq.mockRejectedValue(new Error('SQS down'))

    const promise = publishWithDurability(mockSnsClient, topicArn, payload, context)
    await vi.runAllTimersAsync()
    await expect(promise).resolves.toBeUndefined()
  })

  test('logs success after routing to DLQ', async () => {
    publish.mockRejectedValue(new Error('SNS down'))
    sendToDlq.mockResolvedValue()

    const promise = publishWithDurability(mockSnsClient, topicArn, payload, context)
    await vi.runAllTimersAsync()
    await promise

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: 'case-1', correlationId: 'corr-1' }),
      'Failed SNS publish routed to DLQ'
    )
  })

  test('passes snsClient and topicArn to publish', async () => {
    publish.mockResolvedValue()

    const promise = publishWithDurability(mockSnsClient, topicArn, payload, context)
    await vi.runAllTimersAsync()
    await promise

    expect(publish).toHaveBeenCalledWith(mockSnsClient, topicArn, payload)
  })

  test('logs warn on each failed attempt with attempt/maxAttempts info', async () => {
    publish
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue()

    const promise = publishWithDurability(mockSnsClient, topicArn, payload, context)
    await vi.runAllTimersAsync()
    await promise

    expect(mockLogger.warn).toHaveBeenCalledTimes(2)
    expect(mockLogger.warn).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ attempt: 1, maxAttempts: 3 }),
      expect.any(String)
    )
    expect(mockLogger.warn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ attempt: 2, maxAttempts: 3 }),
      expect.any(String)
    )
  })
})
