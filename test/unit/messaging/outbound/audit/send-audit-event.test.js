import { vi, describe, beforeEach, test, expect } from 'vitest'
import { createLogger } from '../../../../../src/logging/logger.js'

vi.mock('@defra/fcp-audit-publisher', () => ({
  publishAuditEvent: vi.fn().mockResolvedValue({ messageId: 'test-message-id' })
}))

vi.mock('../../../../../src/messaging/sns/client.js', () => ({
  snsClient: { send: vi.fn().mockResolvedValue({ MessageId: 'mock-message-id' }) }
}))

vi.mock('../../../../../src/logging/logger.js', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
}))

const mockLogger = createLogger()

const mockAuditEvent = {
  audit: {
    entities: [
      { entity: 'case', action: 'created' }
    ],
    accounts: {
      sbi: '123456789',
      crn: '1234567890'
    }
  }
}

describe('sendAuditEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('should call publishAuditEvent with event and service-level config', async () => {
    const { publishAuditEvent } = await import('@defra/fcp-audit-publisher')
    const { sendAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

    await sendAuditEvent(mockAuditEvent)

    expect(publishAuditEvent).toHaveBeenCalledWith(
      mockAuditEvent,
      expect.objectContaining({
        application: 'fcp-sfd-crm',
        component: 'fcp-sfd-crm',
        version: '1.0.0',
        generateCorrelationId: true,
        ip: '0.0.0.0'
      })
    )
  })

  test('should not throw when publishAuditEvent rejects', async () => {
    const { publishAuditEvent } = await import('@defra/fcp-audit-publisher')
    const { sendAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

    publishAuditEvent.mockRejectedValueOnce(new Error('SNS failure'))

    await expect(sendAuditEvent(mockAuditEvent)).resolves.not.toThrow()
  })

  test('should log error when publishAuditEvent rejects', async () => {
    const { publishAuditEvent } = await import('@defra/fcp-audit-publisher')
    const { sendAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

    const mockError = new Error('SNS failure')
    publishAuditEvent.mockRejectedValueOnce(mockError)

    await sendAuditEvent(mockAuditEvent)

    expect(mockLogger.error).toHaveBeenCalledWith(
      { event: { type: 'audit_publish_failed', outcome: 'failure', reason: mockError.message } },
      'Failed to publish audit event'
    )
  })
})
