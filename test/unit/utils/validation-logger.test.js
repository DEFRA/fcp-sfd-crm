import { describe, it, expect, vi, beforeEach } from 'vitest'
import { logInboundValidationFailure, logOutboundValidationFailure } from '../../../src/utils/validation-logger.js'

describe('logInboundValidationFailure', () => {
  const mockLogger = { error: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should log an Error object with validation details', () => {
    const joiError = {
      details: [
        { path: ['data', 'sourceSystem'], type: 'any.required', context: { value: undefined }, message: '"data.sourceSystem" is required' },
        { path: ['data', 'file', 'url'], type: 'any.required', context: { value: undefined }, message: '"data.file.url" is required' }
      ]
    }

    const payload = { id: 'evt-1', source: 'fcp-sfd-object-processor', type: 'uk.gov.fcp.sfd.document.uploaded' }

    logInboundValidationFailure(mockLogger, joiError, payload)

    expect(mockLogger.error).toHaveBeenCalledTimes(1)

    const [err, message] = mockLogger.error.mock.calls[0]
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toContain('2 error(s)')
    expect(err.message).toContain('data.sourceSystem')
    expect(err.message).toContain('data.file.url')
    expect(err.message).toContain('fcp-sfd-object-processor')
    expect(err.message).toContain('evt-1')
    expect(err.message).toContain('was discarded')
    expect(err.validationErrors).toHaveLength(2)
    expect(err.source).toBe('fcp-sfd-object-processor')
    expect(err.eventId).toBe('evt-1')
    expect(err.eventType).toBe('uk.gov.fcp.sfd.document.uploaded')
    expect(message).toBe('Inbound message failed validation')
  })

  it('should truncate long values in validation errors', () => {
    const longValue = 'x'.repeat(200)
    const joiError = {
      details: [
        { path: ['data', 'file', 'url'], type: 'string.max', context: { value: longValue }, message: '"data.file.url" exceeds max length' }
      ]
    }

    const payload = { id: 'evt-2', source: 'test-source', type: 'test.type' }

    logInboundValidationFailure(mockLogger, joiError, payload)

    const [err] = mockLogger.error.mock.calls[0]
    expect(err.validationErrors[0].value).toHaveLength(100)
  })

  it('should handle missing payload fields gracefully', () => {
    const joiError = {
      details: [
        { path: ['id'], type: 'any.required', context: { value: undefined }, message: '"id" is required' }
      ]
    }

    logInboundValidationFailure(mockLogger, joiError, {})

    const [err] = mockLogger.error.mock.calls[0]
    expect(err.message).toContain("'unknown'")
    expect(err.source).toBeUndefined()
    expect(err.eventId).toBeUndefined()
  })

  it('should handle null payload gracefully', () => {
    const joiError = {
      details: [
        { path: ['id'], type: 'any.required', context: { value: undefined }, message: '"id" is required' }
      ]
    }

    logInboundValidationFailure(mockLogger, joiError, null)

    const [err] = mockLogger.error.mock.calls[0]
    expect(err.message).toContain("'unknown'")
  })
})

describe('logOutboundValidationFailure', () => {
  const mockLogger = { error: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should log with outbound label in Error message', () => {
    const joiError = {
      details: [
        { path: ['data', 'caseId'], type: 'any.required', context: { value: undefined }, message: '"data.caseId" is required' }
      ]
    }

    const payload = { id: 'evt-out-1', source: 'fcp-sfd-crm', type: 'uk.gov.fcp.sfd.crm.case.created' }

    logOutboundValidationFailure(mockLogger, joiError, payload)

    expect(mockLogger.error).toHaveBeenCalledTimes(1)

    const [err, message] = mockLogger.error.mock.calls[0]
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toContain('Outbound SNS event failed validation')
    expect(err.message).toContain('data.caseId')
    expect(err.message).toContain('fcp-sfd-crm')
    expect(err.message).toContain('evt-out-1')
    expect(err.validationErrors).toHaveLength(1)
    expect(message).toBe('Outbound SNS event failed validation')
  })
})
