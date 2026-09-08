import { vi, describe, beforeEach, test, expect } from 'vitest'
import { createLogger } from '../../../../../src/logging/logger.js'

const { mockNetworkInterfaces } = vi.hoisted(() => ({
  mockNetworkInterfaces: vi.fn()
}))

vi.mock('node:os', () => ({
  networkInterfaces: mockNetworkInterfaces
}))

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

// A single non-internal IPv4 interface, matching a typical container network setup.
const externalIpv4Interfaces = {
  eth0: [
    { family: 'IPv4', internal: false, address: '10.1.2.3' }
  ]
}

const loopbackOnlyInterfaces = {
  lo: [
    { family: 'IPv4', internal: true, address: '127.0.0.1' }
  ]
}

describe('sendAuditEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mockNetworkInterfaces.mockReturnValue(externalIpv4Interfaces)
  })

  test('should call publishAuditEvent with event and service-level config when the event is structurally valid', async () => {
    const { publishAuditEvent, validateAuditEvent } = await import('@defra/fcp-audit-publisher')
    const { sendAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

    validateAuditEvent.mockReturnValueOnce({ valid: true })

    await sendAuditEvent(mockAuditEvent)

    expect(publishAuditEvent).toHaveBeenCalledWith(
      mockAuditEvent,
      expect.objectContaining({
        application: 'Single Front Door',
        component: 'fcp-sfd-crm',
        version: '1.0.0',
        generateCorrelationId: true,
        ip: '10.1.2.3'
      })
    )
  })

  test('should publish the loopback address when no external interface is found', async () => {
    const { publishAuditEvent } = await import('@defra/fcp-audit-publisher')
    const { sendAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

    mockNetworkInterfaces.mockReturnValue(loopbackOnlyInterfaces)

    await sendAuditEvent(mockAuditEvent)

    expect(publishAuditEvent).toHaveBeenCalledWith(
      mockAuditEvent,
      expect.objectContaining({ ip: '127.0.0.1' })
    )
  })

  test('should publish the loopback address and warn when interface resolution throws', async () => {
    const { publishAuditEvent } = await import('@defra/fcp-audit-publisher')
    const { sendAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

    mockNetworkInterfaces.mockImplementation(() => { throw new TypeError('no interfaces') })

    await sendAuditEvent(mockAuditEvent)

    expect(publishAuditEvent).toHaveBeenCalledWith(
      mockAuditEvent,
      expect.objectContaining({ ip: '127.0.0.1' })
    )
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ action: 'service_ip_resolution_failed', outcome: 'failure' }),
        error: { type: 'TypeError' }
      }),
      expect.any(String)
    )
  })

  test('should resolve the service IP once and reuse it on later events', async () => {
    const { publishAuditEvent } = await import('@defra/fcp-audit-publisher')
    const { sendAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

    await sendAuditEvent(mockAuditEvent)
    mockNetworkInterfaces.mockReturnValue(loopbackOnlyInterfaces)
    await sendAuditEvent(mockAuditEvent)

    expect(publishAuditEvent).toHaveBeenLastCalledWith(
      mockAuditEvent,
      expect.objectContaining({ ip: '10.1.2.3' })
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
        audit: { validation: { fields: ['correlationid'] } }
      },
      'Failed to publish audit event'
    )
  })

  test('should log the failing field only, never a validation message that interpolates the value', async () => {
    const { validateAuditEvent } = await import('@defra/fcp-audit-publisher')
    const { sendAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

    // string.pattern.base is the joi rule that echoes the offending value.
    validateAuditEvent.mockReturnValueOnce({
      valid: false,
      errors: ['"audit.accounts.crn" with value "1050000001" fails to match the required pattern: /^\\d+$/']
    })

    await sendAuditEvent(mockAuditEvent)

    const [loggedPayload] = mockLogger.error.mock.calls[0]
    expect(loggedPayload.audit).toEqual({ validation: { fields: ['audit.accounts.crn'] } })
    expect(JSON.stringify(loggedPayload)).not.toContain('1050000001')
  })

  test('should de-duplicate fields and fall back to "unknown" for an unparseable validation message', async () => {
    const { validateAuditEvent } = await import('@defra/fcp-audit-publisher')
    const { sendAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

    validateAuditEvent.mockReturnValueOnce({
      valid: false,
      errors: ['"ip" is required', '"ip" must be a string', 'something unexpected']
    })

    await sendAuditEvent(mockAuditEvent)

    const [loggedPayload] = mockLogger.error.mock.calls[0]
    expect(loggedPayload.audit.validation.fields).toEqual(['ip', 'unknown'])
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
        },
        error: { type: 'Error' }
      },
      'Failed to publish audit event'
    )
  })

  test('should log the error class but not the error message, which can carry the topic ARN', async () => {
    const { publishAuditEvent } = await import('@defra/fcp-audit-publisher')
    const { sendAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

    const configError = new TypeError('Invalid config: "sns.topicArn" must be a string')
    publishAuditEvent.mockRejectedValueOnce(configError)

    await sendAuditEvent(mockAuditEvent)

    const [loggedPayload] = mockLogger.error.mock.calls[0]
    expect(loggedPayload.error).toEqual({ type: 'TypeError' })
    expect(JSON.stringify(loggedPayload)).not.toContain('topicArn')
  })

  test('should classify a thrown non-Error as UnknownError rather than omitting the class', async () => {
    const { publishAuditEvent } = await import('@defra/fcp-audit-publisher')
    const { sendAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

    publishAuditEvent.mockRejectedValueOnce('a bare string rejection')

    await sendAuditEvent(mockAuditEvent)

    const [loggedPayload] = mockLogger.error.mock.calls[0]
    expect(loggedPayload.error).toEqual({ type: 'UnknownError' })
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

  test('should publish successfully when sendAuditEvent resolves normally', async () => {
    const { publishAuditEvent, validateAuditEvent } = await import('@defra/fcp-audit-publisher')
    const { emitAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

    validateAuditEvent.mockReturnValueOnce({ valid: true })

    await emitAuditEvent(mockAuditEvent)

    expect(publishAuditEvent).toHaveBeenCalledWith(mockAuditEvent, expect.any(Object))
  })

  // The catch below is the single mechanism standing between an audit failure
  // and the SQS message pipeline, so it is exercised directly rather than
  // deferred to a call site. sendAuditEvent catches the publish itself, but
  // not validateAuditEvent, which is third-party code called before its try
  // block.
  test('should not throw, and should log an unexpected reason, when validation itself throws', async () => {
    const { validateAuditEvent } = await import('@defra/fcp-audit-publisher')
    const { emitAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

    validateAuditEvent.mockImplementationOnce(() => { throw new RangeError('validator exploded') })

    await expect(emitAuditEvent(mockAuditEvent)).resolves.toBeUndefined()

    expect(mockLogger.error).toHaveBeenCalledWith(
      {
        event: {
          type: 'error',
          action: 'audit_publish_failed',
          category: 'process',
          outcome: 'failure',
          reason: 'unexpected',
          reference: 'test-correlation-id'
        },
        error: { type: 'RangeError' }
      },
      'Failed to publish audit event'
    )
  })

  test('should omit the reference field when an unexpected failure has no correlationid to report', async () => {
    const { validateAuditEvent } = await import('@defra/fcp-audit-publisher')
    const { emitAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

    validateAuditEvent.mockImplementationOnce(() => { throw new Error('validator exploded') })

    await expect(emitAuditEvent({ audit: mockAuditEvent.audit })).resolves.toBeUndefined()

    const [loggedPayload] = mockLogger.error.mock.calls[0]
    expect(loggedPayload.event).not.toHaveProperty('reference')
  })

  test('should not throw even when the logger itself throws, the one failure that cannot be reported', async () => {
    const { validateAuditEvent } = await import('@defra/fcp-audit-publisher')
    const { emitAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

    validateAuditEvent.mockImplementationOnce(() => { throw new Error('validator exploded') })
    mockLogger.error.mockImplementationOnce(() => { throw new Error('logger exploded') })

    await expect(emitAuditEvent(mockAuditEvent)).resolves.toBeUndefined()
  })
})
