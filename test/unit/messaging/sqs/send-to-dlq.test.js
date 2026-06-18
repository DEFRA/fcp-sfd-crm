import { describe, test, expect, vi, beforeEach } from 'vitest'
import { SendMessageCommand } from '@aws-sdk/client-sqs'
import { sendToDlq } from '../../../../src/messaging/sqs/send-to-dlq.js'

vi.mock('@aws-sdk/client-sqs')

const mockSqsClient = { send: vi.fn() }

const makeEnvelope = (overrides = {}) => ({
  originalPayload: {
    type: 'uk.gov.fcp.sfd.crm.case.created',
    id: 'event-id-1',
    data: { caseId: 'case-1', correlationId: 'corr-1' }
  },
  metadata: {
    caseId: 'case-1',
    correlationId: 'corr-1',
    topicArn: 'arn:aws:sns:eu-west-2:123:topic',
    failedAt: '2026-06-15T10:00:00.000Z',
    errorMessage: 'SNS connection error',
    errorName: 'Error',
    totalAttempts: 3,
    source: 'fcp-sfd-crm'
  },
  ...overrides
})

describe('sendToDlq', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSqsClient.send.mockResolvedValue({})
  })

  test('sends message to the correct queue URL', async () => {
    const envelope = makeEnvelope()
    await sendToDlq(mockSqsClient, 'https://queue-url', envelope)

    expect(SendMessageCommand).toHaveBeenCalledWith(
      expect.objectContaining({ QueueUrl: 'https://queue-url' })
    )
    expect(mockSqsClient.send).toHaveBeenCalledTimes(1)
  })

  test('serialises the full envelope as the message body', async () => {
    const envelope = makeEnvelope()
    await sendToDlq(mockSqsClient, 'https://queue-url', envelope)

    expect(SendMessageCommand).toHaveBeenCalledWith(
      expect.objectContaining({ MessageBody: JSON.stringify(envelope) })
    )
  })

  test('sets eventType MessageAttribute from originalPayload.type', async () => {
    const envelope = makeEnvelope()
    await sendToDlq(mockSqsClient, 'https://queue-url', envelope)

    expect(SendMessageCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        MessageAttributes: expect.objectContaining({
          eventType: { DataType: 'String', StringValue: 'uk.gov.fcp.sfd.crm.case.created' }
        })
      })
    )
  })

  test('sets source MessageAttribute from metadata.source', async () => {
    const envelope = makeEnvelope()
    await sendToDlq(mockSqsClient, 'https://queue-url', envelope)

    expect(SendMessageCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        MessageAttributes: expect.objectContaining({
          source: { DataType: 'String', StringValue: 'fcp-sfd-crm' }
        })
      })
    )
  })

  test('sets failureReason MessageAttribute from metadata.errorMessage', async () => {
    const envelope = makeEnvelope()
    await sendToDlq(mockSqsClient, 'https://queue-url', envelope)

    expect(SendMessageCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        MessageAttributes: expect.objectContaining({
          failureReason: { DataType: 'String', StringValue: 'SNS connection error' }
        })
      })
    )
  })

  test('truncates failureReason to 256 chars', async () => {
    const longError = 'x'.repeat(300)
    const envelope = makeEnvelope({ metadata: { ...makeEnvelope().metadata, errorMessage: longError } })
    await sendToDlq(mockSqsClient, 'https://queue-url', envelope)

    expect(SendMessageCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        MessageAttributes: expect.objectContaining({
          failureReason: { DataType: 'String', StringValue: 'x'.repeat(256) }
        })
      })
    )
  })

  test('falls back to "unknown" for missing originalPayload.type', async () => {
    const envelope = makeEnvelope({ originalPayload: null })
    await sendToDlq(mockSqsClient, 'https://queue-url', envelope)

    expect(SendMessageCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        MessageAttributes: expect.objectContaining({
          eventType: { DataType: 'String', StringValue: 'unknown' }
        })
      })
    )
  })

  test('falls back to defaults for missing metadata fields', async () => {
    const envelope = makeEnvelope({ metadata: null })
    await sendToDlq(mockSqsClient, 'https://queue-url', envelope)

    expect(SendMessageCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        MessageAttributes: expect.objectContaining({
          source: { DataType: 'String', StringValue: 'fcp-sfd-crm' },
          failureReason: { DataType: 'String', StringValue: 'unknown' }
        })
      })
    )
  })

  test('propagates error when sqsClient.send throws', async () => {
    mockSqsClient.send.mockRejectedValue(new Error('SQS unavailable'))

    await expect(sendToDlq(mockSqsClient, 'https://queue-url', makeEnvelope())).rejects.toThrow('SQS unavailable')
  })
})
