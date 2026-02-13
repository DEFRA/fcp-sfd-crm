import { vi, describe, beforeEach, test, expect } from 'vitest'
import { createLogger } from '../../../../../src/logging/logger.js'
import { config } from '../../../../../src/config/index.js'
import { snsClient } from '../../../../../src/messaging/sns/client.js'
import { publish } from '../../../../../src/messaging/sns/publish.js'
import { publishReceivedEvent } from '../../../../../src/messaging/outbound/received-event/publish-received-event.js'
import mockCrmRequest from '../../../../mocks/v1-received-event.js'

vi.mock('../../../../../src/messaging/sns/publish.js')

vi.mock('../../../../../src/logging/logger.js', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

const mockLogger = createLogger()

describe('Publish received request', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-27T11:00:00.000Z'))
  })

  test('should publish a received request with type CREATED if request event type is CREATED', async () => {
    await publishReceivedEvent(mockCrmRequest)

    expect(publish).toHaveBeenCalledWith(
      snsClient,
      config.get('messaging.crmEvents.topicArn'),
      expect.objectContaining({
        type: 'uk.gov.fcp.sfd.crm.case.created'
      })
    )
  })

  test('should publish and include all original message data within the event', async () => {
    await publishReceivedEvent(mockCrmRequest)

    expect(publish).toHaveBeenCalledWith(
      snsClient,
      config.get('messaging.crmEvents.topicArn'),
      expect.objectContaining({
        data: {
          ...mockCrmRequest.data,
          correlationId: mockCrmRequest.id,
          caseType: 'case-created'
        }
      })
    )
  })

  test('should use message.id as correlationId when data.correlationId is missing', async () => {
    const messageWithoutCorrelationId = {
      id: 'msg-id-123',
      type: 'uk.gov.fcp.sfd.crm.case.created',
      data: { caseId: 'case-1', crn: 123 }
    }
    await publishReceivedEvent(messageWithoutCorrelationId)

    expect(publish).toHaveBeenCalledWith(
      snsClient,
      config.get('messaging.crmEvents.topicArn'),
      expect.objectContaining({
        data: expect.objectContaining({
          correlationId: 'msg-id-123'
        })
      })
    )
  })

  test('should log error if publishing of event fails', async () => {
    const mockError = new Error('Publish error')

    publish.mockRejectedValue(mockError)

    await publishReceivedEvent(mockCrmRequest)

    expect(mockLogger.error).toHaveBeenCalledWith(
      mockError,
      'Error publishing received CRM request event'
    )
  })

  test('should throw and log error when CloudEvent type is missing', async () => {
    await expect(
      publishReceivedEvent({
        ...mockCrmRequest,
        type: null
      })
    ).rejects.toThrow('CloudEvent type is required to publish CRM event')

    expect(mockLogger.error).toHaveBeenCalledWith('Cannot publish event, message.type is missing')
  })

  test('should throw and log error when trying to process unsupported caseType', async () => {
    await expect(
      publishReceivedEvent({
        ...mockCrmRequest,
        type: 'unsupported-event-type'
      })
    ).rejects.toThrow('Unsupported CloudEvent type: unsupported-event-type')

    expect(mockLogger.error).toHaveBeenCalledWith('Unsupported CloudEvent type: unsupported-event-type')
  })
})
