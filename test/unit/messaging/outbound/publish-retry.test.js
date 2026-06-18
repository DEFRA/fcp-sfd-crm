import { describe, test, expect, vi, beforeEach } from 'vitest'

const mockLogger = { error: vi.fn(), info: vi.fn() }

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
      if (key === 'messaging.crmEvents.publishDlqUrl') return 'https://publish-dlq-url'
      return undefined
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
  })

  test('resolves without calling sendToDlq when publish succeeds', async () => {
    publish.mockResolvedValue()

    await publishWithDurability(mockSnsClient, topicArn, payload, context)

    expect(publish).toHaveBeenCalledTimes(1)
    expect(sendToDlq).not.toHaveBeenCalled()
  })

  test('passes snsClient, topicArn, and payload to publish', async () => {
    publish.mockResolvedValue()

    await publishWithDurability(mockSnsClient, topicArn, payload, context)

    expect(publish).toHaveBeenCalledWith(mockSnsClient, topicArn, payload)
  })

  test('calls sendToDlq with correct envelope when publish fails', async () => {
    const publishErr = new Error('SNS down')
    publishErr.name = 'ServiceUnavailableError'
    publish.mockRejectedValue(publishErr)
    sendToDlq.mockResolvedValue()

    await publishWithDurability(mockSnsClient, topicArn, payload, context)

    expect(publish).toHaveBeenCalledTimes(1)
    expect(sendToDlq).toHaveBeenCalledTimes(1)

    const [, , envelope] = sendToDlq.mock.calls[0]
    expect(envelope.originalPayload).toBe(payload)
    expect(envelope.metadata).toMatchObject({
      caseId: 'case-1',
      correlationId: 'corr-1',
      topicArn,
      errorMessage: 'SNS down',
      errorName: 'ServiceUnavailableError',
      source: 'fcp-sfd-crm'
    })
    expect(envelope.metadata.failedAt).toBeDefined()
  })

  test('logs success after routing failed publish to DLQ', async () => {
    publish.mockRejectedValue(new Error('SNS down'))
    sendToDlq.mockResolvedValue()

    await publishWithDurability(mockSnsClient, topicArn, payload, context)

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: 'case-1', correlationId: 'corr-1' }),
      'Failed SNS publish routed to DLQ'
    )
  })

  test('logs CRITICAL and does not throw when DLQ send also fails', async () => {
    publish.mockRejectedValue(new Error('SNS down'))
    sendToDlq.mockRejectedValue(new Error('SQS also down'))

    await expect(publishWithDurability(mockSnsClient, topicArn, payload, context)).resolves.toBeUndefined()

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: 'case-1', correlationId: 'corr-1' }),
      expect.stringContaining('CRITICAL')
    )
  })

  test('never throws even when both SNS publish and DLQ fail', async () => {
    publish.mockRejectedValue(new Error('SNS down'))
    sendToDlq.mockRejectedValue(new Error('SQS down'))

    await expect(publishWithDurability(mockSnsClient, topicArn, payload, context)).resolves.toBeUndefined()
  })

  test('falls back to "unknown" errorMessage when error has no message', async () => {
    const err = { name: 'CustomError' }
    publish.mockRejectedValue(err)
    sendToDlq.mockResolvedValue()

    await publishWithDurability(mockSnsClient, topicArn, payload, context)

    const [, , envelope] = sendToDlq.mock.calls[0]
    expect(envelope.metadata.errorMessage).toBe('unknown')
    expect(envelope.metadata.errorName).toBe('CustomError')
  })

  test('falls back to "Error" errorName when error has no name', async () => {
    const err = { message: 'something broke' }
    publish.mockRejectedValue(err)
    sendToDlq.mockResolvedValue()

    await publishWithDurability(mockSnsClient, topicArn, payload, context)

    const [, , envelope] = sendToDlq.mock.calls[0]
    expect(envelope.metadata.errorMessage).toBe('something broke')
    expect(envelope.metadata.errorName).toBe('Error')
  })
})
