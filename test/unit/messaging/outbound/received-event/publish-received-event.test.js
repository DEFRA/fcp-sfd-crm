import { vi, describe, beforeEach, test, expect } from 'vitest'
import { createLogger } from '../../../../../src/logging/logger.js'
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
      'arn:aws:sns:eu-west-2:000000000000:fcp_sfd_crm_events',
      expect.objectContaining({
        type: 'uk.gov.fcp.sfd.crm.case.created'
      })
    )
  })

  test('should publish and include all original message data within the event', async () => {
    await publishReceivedEvent(mockCrmRequest)

    expect(publish).toHaveBeenCalledWith(
      snsClient,
      'arn:aws:sns:eu-west-2:000000000000:fcp_sfd_crm_events',
      expect.objectContaining({
        data: {
          ...mockCrmRequest.data,
          correlationId: mockCrmRequest.id
        }
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
})
