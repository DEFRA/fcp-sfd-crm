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
  contactId: 'cid-1',
  accounts: { crn: '123' },
  correlationId: 'corr-1'
}

describe('sendAuditEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('maps person.read to normalized audit payload', async () => {
    const { publishAuditEvent } = await import('@defra/fcp-audit-publisher')
    const { sendAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

    await sendAuditEvent(mockAuditEvent)

    expect(publishAuditEvent).toHaveBeenCalledWith(
      {
        audit: {
          entities: [{ entity: 'person', action: 'read', entityid: 'cid-1' }],
          accounts: { crn: '123' }
        },
        correlationid: 'corr-1'
      },
      expect.objectContaining({
        application: 'fcp-sfd-crm',
        component: 'fcp-sfd-crm',
        version: '1.0.0',
        generateCorrelationId: true,
        ip: '0.0.0.0'
      })
    )
  })

  test('maps accountId to business entity', async () => {
    const { publishAuditEvent } = await import('@defra/fcp-audit-publisher')
    const { sendAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

    await sendAuditEvent({ accountId: 'acc-1', accounts: { sbi: '999' }, correlationId: 'corr-3' })

    expect(publishAuditEvent).toHaveBeenCalledWith(
      {
        audit: {
          entities: [{ entity: 'business', action: 'read', entityid: 'acc-1' }],
          accounts: { sbi: '999' }
        },
        correlationid: 'corr-3'
      },
      expect.any(Object)
    )
  })

  test('maps caseId and metadataId entities', async () => {
    const { publishAuditEvent } = await import('@defra/fcp-audit-publisher')
    const { sendAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

    await sendAuditEvent({ caseId: 'case-99', metadataId: 'meta-99', correlationId: 'corr-4' })

    expect(publishAuditEvent).toHaveBeenCalledTimes(1)
    const payload = publishAuditEvent.mock.calls[0][0]
    const entityTypes = payload.audit.entities.map(e => e.entity)
    expect(entityTypes).toEqual(['document', 'document'])
    expect(payload.correlationid).toBe('corr-4')
  })

  test('copies audit.status and audit.details from data', async () => {
    const { publishAuditEvent } = await import('@defra/fcp-audit-publisher')
    const { sendAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

    await sendAuditEvent({ audit: { status: 'failure', details: { reason: 'CRN not found' } } })

    expect(publishAuditEvent).toHaveBeenCalledWith(
      {
        audit: {
          entities: [{ entity: 'service', action: 'event', entityid: '' }],
          status: 'failure',
          details: { reason: 'CRN not found' },
          accounts: {}
        }
      },
      expect.any(Object)
    )
  })

  test('sends security payload and coerces non-object details', async () => {
    const { publishAuditEvent } = await import('@defra/fcp-audit-publisher')
    const { sendAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

    await sendAuditEvent({ security: { user: 'u', details: 'failed' }, correlationId: 'corr-2' })

    expect(publishAuditEvent).toHaveBeenCalledWith(
      {
        security: { user: 'u', details: { message: 'failed' } },
        correlationid: 'corr-2'
      },
      expect.any(Object)
    )
  })

  test('coerces audit.details string to object and uses fallback entity', async () => {
    const { publishAuditEvent } = await import('@defra/fcp-audit-publisher')
    const { sendAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

    await sendAuditEvent({ audit: { details: 'plain message' } })

    expect(publishAuditEvent).toHaveBeenCalledWith(
      {
        audit: {
          entities: [{ entity: 'service', action: 'event', entityid: '' }],
          details: { message: 'plain message' },
          accounts: {}
        }
      },
      expect.any(Object)
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
