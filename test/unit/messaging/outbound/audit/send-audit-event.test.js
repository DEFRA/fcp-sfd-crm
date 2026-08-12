import { vi, describe, beforeEach, test, expect } from 'vitest'
import { createLogger } from '../../../../../src/logging/logger.js'

vi.mock('@defra/fcp-audit-publisher', () => ({
  publishAuditEvent: vi.fn().mockResolvedValue({ messageId: 'test-message-id' }),
  validateAuditEvent: vi.fn().mockReturnValue({ valid: true })
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
  correlationid: 'test-correlation-id',
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

  test('should call publishAuditEvent with event and service-level config when the event is structurally valid', async () => {
    const { publishAuditEvent, validateAuditEvent } = await import('@defra/fcp-audit-publisher')
    const { sendAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

    validateAuditEvent.mockReturnValueOnce({ valid: true })

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

  test('should not call publishAuditEvent when the event fails structural validation', async () => {
    const { publishAuditEvent, validateAuditEvent } = await import('@defra/fcp-audit-publisher')
    const { sendAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

    validateAuditEvent.mockReturnValueOnce({ valid: false, errors: ['"correlationid" length must be less than or equal to 50 characters long'] })

    await sendAuditEvent(mockAuditEvent)

    expect(publishAuditEvent).not.toHaveBeenCalled()
  })

  test('should log a schema_validation reason when the event fails structural validation, without calling SNS', async () => {
    const { validateAuditEvent } = await import('@defra/fcp-audit-publisher')
    const { sendAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

    validateAuditEvent.mockReturnValueOnce({ valid: false, errors: ['"correlationid" is required'] })

    await sendAuditEvent(mockAuditEvent)

    expect(mockLogger.error).toHaveBeenCalledWith(
      {
        event: {
          type: 'error',
          action: 'audit_publish_failed',
          category: 'process',
          outcome: 'failure',
          reason: 'schema_validation',
          reference: 'test-correlation-id'
        },
        errors: ['"correlationid" is required']
      },
      'Failed to publish audit event'
    )
  })

  test('should not throw when publishAuditEvent rejects', async () => {
    const { publishAuditEvent } = await import('@defra/fcp-audit-publisher')
    const { sendAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

    publishAuditEvent.mockRejectedValueOnce(new Error('SNS failure'))

    await expect(sendAuditEvent(mockAuditEvent)).resolves.not.toThrow()
  })

  test('should log a transport reason when publishAuditEvent rejects after passing structural validation', async () => {
    const { publishAuditEvent } = await import('@defra/fcp-audit-publisher')
    const { sendAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

    publishAuditEvent.mockRejectedValueOnce(new Error('SNS failure'))

    await sendAuditEvent(mockAuditEvent)

    expect(mockLogger.error).toHaveBeenCalledWith(
      {
        event: {
          type: 'error',
          action: 'audit_publish_failed',
          category: 'process',
          outcome: 'failure',
          reason: 'transport',
          reference: 'test-correlation-id'
        }
      },
      'Failed to publish audit event'
    )
  })

  test('should omit the reference field entirely when the event has no correlationid', async () => {
    const { publishAuditEvent } = await import('@defra/fcp-audit-publisher')
    const { sendAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

    publishAuditEvent.mockRejectedValueOnce(new Error('SNS failure'))

    await sendAuditEvent({ audit: mockAuditEvent.audit })

    const [loggedPayload] = mockLogger.error.mock.calls[0]
    expect(loggedPayload.event).not.toHaveProperty('reference')
  })

  test('should not log the event payload, only the failure classification', async () => {
    const { publishAuditEvent } = await import('@defra/fcp-audit-publisher')
    const { sendAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

    publishAuditEvent.mockRejectedValueOnce(new Error('SNS failure'))

    await sendAuditEvent(mockAuditEvent)

    const [loggedPayload] = mockLogger.error.mock.calls[0]
    expect(loggedPayload).not.toHaveProperty('audit')
    expect(loggedPayload).not.toHaveProperty('event.entities')
  })
})

describe('emitAuditEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // emitAuditEvent's own catch branch (reason: 'unexpected') only triggers
  // when sendAuditEvent itself throws, which cannot happen through the real
  // implementation (it always catches internally). That branch exists as a
  // backstop for call sites that mock sendAuditEvent directly and is
  // exercised there instead — see the audit-isolation tests in
  // crm-helpers.test.js, case.test.js and server.test.js.

  test('should publish successfully when sendAuditEvent resolves normally', async () => {
    const { publishAuditEvent, validateAuditEvent } = await import('@defra/fcp-audit-publisher')
    const { emitAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

    validateAuditEvent.mockReturnValueOnce({ valid: true })

    await emitAuditEvent(mockAuditEvent)

    expect(publishAuditEvent).toHaveBeenCalledWith(mockAuditEvent, expect.any(Object))
  })
})
