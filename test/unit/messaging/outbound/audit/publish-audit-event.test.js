import { vi, describe, beforeEach, test, expect } from 'vitest'
import { createLogger } from '../../../../../src/logging/logger.js'

vi.mock('@defra/fcp-audit-publisher', () => ({
  publishAuditEvent: vi.fn().mockResolvedValue({ messageId: 'test-message-id' })
}))

vi.mock('../../../../../src/messaging/sns/client.js', () => ({
  snsClient: {}
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

describe('publishAuditEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('should call publishAuditEvent with event and service-level config', async () => {
    const { publishAuditEvent: _publishAuditEvent } = await import('@defra/fcp-audit-publisher')
    const { publishAuditEvent } = await import('../../../../../src/messaging/outbound/audit/publish-audit-event.js')

    await publishAuditEvent(mockAuditEvent)

    expect(_publishAuditEvent).toHaveBeenCalledWith(
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
    const { publishAuditEvent: _publishAuditEvent } = await import('@defra/fcp-audit-publisher')
    const { publishAuditEvent } = await import('../../../../../src/messaging/outbound/audit/publish-audit-event.js')

    _publishAuditEvent.mockRejectedValueOnce(new Error('SNS failure'))

    await expect(publishAuditEvent(mockAuditEvent)).resolves.not.toThrow()
  })

  test('should log error when publishAuditEvent rejects', async () => {
    const { publishAuditEvent: _publishAuditEvent } = await import('@defra/fcp-audit-publisher')
    const { publishAuditEvent } = await import('../../../../../src/messaging/outbound/audit/publish-audit-event.js')

    const mockError = new Error('SNS failure')
    _publishAuditEvent.mockRejectedValueOnce(mockError)

    await publishAuditEvent(mockAuditEvent)

    expect(mockLogger.error).toHaveBeenCalledWith(
      { event: { type: 'audit_publish_failed', outcome: 'failure', reason: mockError.message } },
      'Failed to publish audit event'
    )
  })
})
