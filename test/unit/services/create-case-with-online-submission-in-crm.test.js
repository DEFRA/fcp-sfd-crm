import { describe, test, expect, vi, beforeEach } from 'vitest'
import { crmEvents } from '../../../src/constants/events.js'

const mockLogger = { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() }

vi.mock('../../../src/logging/logger.js', () => ({
  createLogger: () => mockLogger
}))

vi.mock('../../../src/repos/crm.js', () => ({
  getContactIdFromCrn: vi.fn(),
  getAccountIdFromSbi: vi.fn(),
  createCaseWithOnlineSubmission: vi.fn(),
  getCaseIdByOnlineSubmissionId: vi.fn(),
  getDocumentTypeMetadata: vi.fn()
}))

vi.mock('../../../src/messaging/outbound/received-event/publish-received-event.js', () => ({
  publishReceivedEvent: vi.fn()
}))

const { createCaseWithOnlineSubmissionInCrm } = await import('../../../src/services/create-case-with-online-submission-in-crm.js')
const { getContactIdFromCrn, getAccountIdFromSbi, createCaseWithOnlineSubmission, getCaseIdByOnlineSubmissionId, getDocumentTypeMetadata } = await import('../../../src/repos/crm.js')
const { publishReceivedEvent } = await import('../../../src/messaging/outbound/received-event/publish-received-event.js')

describe('createCaseWithOnlineSubmissionInCrm service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns contactId, accountId, caseId, and rpaOnlinesubmissionid on success without separate GET', async () => {
    const mockDocTypeMetadata = {
      schemeValue: 'mock-scheme',
      subjectValue: 'mock-subject',
      documentTypesId: 'mock-doc-type-id'
    }
    getContactIdFromCrn.mockResolvedValue({ contactId: 'mock-contact-id' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: 'mock-account-id' })
    getDocumentTypeMetadata.mockResolvedValue({ documentTypeMetadata: mockDocTypeMetadata, error: null })
    createCaseWithOnlineSubmission.mockResolvedValue({ caseId: 'mock-case-id', rpaOnlinesubmissionid: 'mock-ols-id', error: null })

    const request = {
      authToken: 'mock-bearer-token',
      correlationId: 'mock-correlation-id',
      caseType: 'CS_Agreement_Evidence',
      crn: 'mock-crn',
      sbi: 'mock-sbi',
      caseData: { title: 'Test Case', caseDescription: 'Test description' },
      onlineSubmissionActivity: { subject: 'Test', description: 'Test submission' }
    }

    const result = await createCaseWithOnlineSubmissionInCrm(request)

    expect(getContactIdFromCrn).toHaveBeenCalledWith('mock-bearer-token', 'mock-crn')
    expect(getAccountIdFromSbi).toHaveBeenCalledWith('mock-bearer-token', 'mock-sbi')
    expect(getDocumentTypeMetadata).toHaveBeenCalledWith('mock-bearer-token', 'CS_Agreement_Evidence')

    expect(createCaseWithOnlineSubmission).toHaveBeenCalledWith({
      authToken: 'mock-bearer-token',
      case: { ...request.caseData, contactId: 'mock-contact-id', accountId: 'mock-account-id', documentTypeMetadata: mockDocTypeMetadata },
      onlineSubmissionActivity: request.onlineSubmissionActivity
    })

    expect(result).toEqual({
      contactId: 'mock-contact-id',
      accountId: 'mock-account-id',
      caseId: 'mock-case-id',
      rpaOnlinesubmissionid: 'mock-ols-id'
    })
  })

  test('should call publishReceivedEvent with caseId, crn, and sbi', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'mock-contact-id' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: 'mock-account-id' })
    getDocumentTypeMetadata.mockResolvedValue({ documentTypeMetadata: { schemeValue: 's', subjectValue: 'sub', documentTypesId: 'd' }, error: null })
    createCaseWithOnlineSubmission.mockResolvedValue({ caseId: 'mock-case-id', rpaOnlinesubmissionid: 'mock-ols-id', error: null })

    const request = {
      authToken: 'mock-bearer-token',
      correlationId: 'mock-correlation-id',
      caseType: 'CS_Agreement_Evidence',
      crn: '1050000001',
      sbi: '105000001',
      caseData: { title: 'Test Case', caseDescription: 'Test description' },
      onlineSubmissionActivity: { subject: 'Test', description: 'Test submission' }
    }

    await createCaseWithOnlineSubmissionInCrm(request)

    expect(publishReceivedEvent).toHaveBeenCalledWith({
      type: crmEvents.CASE_CREATED,
      data: expect.objectContaining({
        correlationId: 'mock-correlation-id',
        caseId: 'mock-case-id',
        crn: 1050000001,
        sbi: 105000001
      })
    })
  })

  test('throws error if required parameters are missing', async () => {
    await expect(createCaseWithOnlineSubmissionInCrm({
      authToken: null,
      correlationId: null,
      caseType: null,
      crn: null,
      sbi: null,
      caseData: null,
      onlineSubmissionActivity: null
    })).rejects.toThrow('Missing required parameter: authToken')

    expect(mockLogger.error).toHaveBeenCalledWith('Missing required parameter: authToken')
  })

  test('throws error if contact not found', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: null, error: 'Not found' })

    await expect(
      createCaseWithOnlineSubmissionInCrm({
        authToken: 'mock-bearer-token',
        correlationId: 'mock-correlation-id',
        caseType: 'CS_Agreement_Evidence',
        crn: 'mock-crn',
        sbi: 'mock-sbi',
        caseData: {},
        onlineSubmissionActivity: {}
      })
    ).rejects.toMatchObject({
      isBoom: true,
      message: 'Contact ID not found',
      output: { statusCode: 422 }
    })

    expect(mockLogger.error).toHaveBeenCalledWith('No contact found for CRN: ****-crn, error: Not found')
  })

  test('throws error if account not found', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'mock-contact-id' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: null, error: 'Not found' })

    await expect(
      createCaseWithOnlineSubmissionInCrm({
        authToken: 'mock-bearer-token',
        correlationId: 'mock-correlation-id',
        caseType: 'CS_Agreement_Evidence',
        crn: 'mock-crn',
        sbi: 'mock-sbi',
        caseData: {},
        onlineSubmissionActivity: {}
      })
    ).rejects.toMatchObject({
      isBoom: true,
      message: 'Account ID not found',
      output: { statusCode: 422 }
    })

    expect(mockLogger.error).toHaveBeenCalledWith('No account found for SBI: mock-sbi, error: Not found')
  })

  test('throws error if createCaseWithOnlineSubmission returns error', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'mock-contact-id' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: 'mock-account-id' })
    getDocumentTypeMetadata.mockResolvedValue({ documentTypeMetadata: { schemeValue: 's', subjectValue: 'sub', documentTypesId: 'd' }, error: null })
    const caseErr = new Error('CRM service failed')
    caseErr.crmError = '{"error":{"code":"0x80040265","message":"Cannot find record to be updated"}}'
    createCaseWithOnlineSubmission.mockResolvedValue({ caseId: null, error: caseErr })

    await expect(createCaseWithOnlineSubmissionInCrm({
      authToken: 'mock-bearer-token',
      correlationId: 'mock-correlation-id',
      caseType: 'CS_Agreement_Evidence',
      crn: 'mock-crn',
      sbi: 'mock-sbi',
      caseData: {},
      onlineSubmissionActivity: {}
    })).rejects.toThrow('Unable to create case with online submission activity in CRM')

    expect(mockLogger.error).toHaveBeenCalledWith(
      {
        error: caseErr,
        event: {
          category: 'crm_case_create_failed',
          reason: '{"error":{"code":"0x80040265","message":"Cannot find record to be updated"}}'
        }
      },
      'Error creating case with online submission activity'
    )
  })

  test('falls back to lookup by online submission ID when CRM POST response lacks caseId', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'mock-contact-id' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: 'mock-account-id' })
    getDocumentTypeMetadata.mockResolvedValue({ documentTypeMetadata: { schemeValue: 's', subjectValue: 'sub', documentTypesId: 'd' }, error: null })
    createCaseWithOnlineSubmission.mockResolvedValue({ caseId: undefined, rpaOnlinesubmissionid: 'mock-ols-id', error: null })
    getCaseIdByOnlineSubmissionId.mockResolvedValue({ caseId: 'fallback-case-id', error: null })

    const result = await createCaseWithOnlineSubmissionInCrm({
      authToken: 'mock-bearer-token',
      correlationId: 'mock-correlation-id',
      caseType: 'CS_Agreement_Evidence',
      crn: 'mock-crn',
      sbi: 'mock-sbi',
      caseData: {},
      onlineSubmissionActivity: {}
    })

    expect(getCaseIdByOnlineSubmissionId).toHaveBeenCalledWith('mock-bearer-token', 'mock-ols-id')
    expect(result.caseId).toBe('fallback-case-id')
    expect(result.rpaOnlinesubmissionid).toBe('mock-ols-id')
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { rpaOnlinesubmissionid: 'mock-ols-id' },
      'CRM POST response missing incidentid, falling back to lookup by online submission'
    )
  })

  test('throws retryable error when fallback lookup also fails', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'mock-contact-id' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: 'mock-account-id' })
    getDocumentTypeMetadata.mockResolvedValue({ documentTypeMetadata: { schemeValue: 's', subjectValue: 'sub', documentTypesId: 'd' }, error: null })
    createCaseWithOnlineSubmission.mockResolvedValue({ caseId: undefined, rpaOnlinesubmissionid: 'mock-ols-id', error: null })
    getCaseIdByOnlineSubmissionId.mockResolvedValue({ caseId: null, error: new Error('Lookup failed') })

    await expect(createCaseWithOnlineSubmissionInCrm({
      authToken: 'mock-bearer-token',
      correlationId: 'mock-correlation-id',
      caseType: 'CS_Agreement_Evidence',
      crn: 'mock-crn',
      sbi: 'mock-sbi',
      caseData: {},
      onlineSubmissionActivity: {}
    })).rejects.toMatchObject({ message: 'CRM did not return a case ID and fallback lookup failed', retryable: true })

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.any(Error),
        event: expect.objectContaining({
          reference: 'mock-ols-id',
          category: 'fallback_case_lookup_failed',
          reason: 'Lookup failed'
        })
      }),
      'Fallback lookup for caseId failed'
    )
  })

  test('throws retryable error when document type lookup returns HTTP error', async () => {
    const lookupErr = new Error('CRM unavailable')
    lookupErr.retryMetadata = { category: 'retryable', status: 503 }
    getContactIdFromCrn.mockResolvedValue({ contactId: 'mock-contact-id' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: 'mock-account-id' })
    getDocumentTypeMetadata.mockResolvedValue({ documentTypeMetadata: null, error: lookupErr })

    await expect(createCaseWithOnlineSubmissionInCrm({
      authToken: 'mock-bearer-token',
      correlationId: 'mock-correlation-id',
      caseType: 'CS_Agreement_Evidence',
      crn: 'mock-crn',
      sbi: 'mock-sbi',
      caseData: {},
      onlineSubmissionActivity: {}
    })).rejects.toMatchObject({ message: 'CRM unavailable', retryable: true })

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        error: lookupErr,
        caseType: 'CS_Agreement_Evidence',
        event: expect.objectContaining({ category: 'retryable', reason: 'CRM unavailable' })
      }),
      'Error looking up document type metadata'
    )
  })

  test('throws non-retryable error when document type lookup returns non-retryable error', async () => {
    const lookupErr = new Error('Bad request')
    lookupErr.retryMetadata = { category: 'non-retryable', status: 400 }
    getContactIdFromCrn.mockResolvedValue({ contactId: 'mock-contact-id' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: 'mock-account-id' })
    getDocumentTypeMetadata.mockResolvedValue({ documentTypeMetadata: null, error: lookupErr })

    await expect(createCaseWithOnlineSubmissionInCrm({
      authToken: 'mock-bearer-token',
      correlationId: 'mock-correlation-id',
      caseType: 'CS_Agreement_Evidence',
      crn: 'mock-crn',
      sbi: 'mock-sbi',
      caseData: {},
      onlineSubmissionActivity: {}
    })).rejects.toMatchObject({
      retryable: false,
      retryMetadata: expect.objectContaining({ terminalReason: 'document_type_lookup_failed' })
    })

    expect(mockLogger.error).toHaveBeenCalled()
  })

  test('throws non-retryable error when document type lookup returns empty result', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'mock-contact-id' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: 'mock-account-id' })
    getDocumentTypeMetadata.mockResolvedValue({ documentTypeMetadata: null, error: null })

    await expect(createCaseWithOnlineSubmissionInCrm({
      authToken: 'mock-bearer-token',
      correlationId: 'mock-correlation-id',
      caseType: 'NonExistent_Type',
      crn: 'mock-crn',
      sbi: 'mock-sbi',
      caseData: {},
      onlineSubmissionActivity: {}
    })).rejects.toMatchObject({
      retryable: false,
      retryMetadata: { category: 'non-retryable', terminalReason: 'document_type_not_found' }
    })

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        caseType: 'NonExistent_Type',
        event: expect.objectContaining({ category: 'non-retryable', reason: 'document_type_not_found' })
      }),
      'Document type metadata not found for caseType'
    )
  })

  test('throws non-retryable bad request when caseType is invalid', async () => {
    const lookupErr = new Error('Invalid caseType: NonExistent_Type')
    getContactIdFromCrn.mockResolvedValue({ contactId: 'mock-contact-id' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: 'mock-account-id' })
    getDocumentTypeMetadata.mockResolvedValue({ documentTypeMetadata: null, error: lookupErr })

    await expect(createCaseWithOnlineSubmissionInCrm({
      authToken: 'mock-bearer-token',
      correlationId: 'mock-correlation-id',
      caseType: 'NonExistent_Type',
      crn: 'mock-crn',
      sbi: 'mock-sbi',
      caseData: {},
      onlineSubmissionActivity: {}
    })).rejects.toMatchObject({
      isBoom: true,
      output: { statusCode: 400 },
      retryable: false,
      retryMetadata: { category: 'non-retryable', status: 400 }
    })

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        error: lookupErr,
        caseType: 'NonExistent_Type',
        event: expect.objectContaining({
          category: 'invalid_case_type',
          reason: 'Invalid caseType: NonExistent_Type'
        })
      }),
      'Invalid caseType for document type lookup'
    )
  })
})

test('re-throws original retryable CRM error when createCaseWithOnlineSubmission reports retryable', async () => {
  vi.resetModules()
  const mockLogger = { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() }
  vi.doMock('../../../src/logging/logger.js', () => ({ createLogger: () => mockLogger }))

  const retryErr = new Error('CRM transient')
  retryErr.retryMetadata = { category: 'retryable', status: 503 }
  retryErr.crmError = '{"error":{"code":"0x80060891"}}'

  vi.doMock('../../../src/repos/crm.js', () => ({
    getContactIdFromCrn: vi.fn().mockResolvedValue({ contactId: 'c1' }),
    getAccountIdFromSbi: vi.fn().mockResolvedValue({ accountId: 'a1' }),
    getDocumentTypeMetadata: vi.fn().mockResolvedValue({ documentTypeMetadata: { schemeValue: 's', subjectValue: 'sub', documentTypesId: 'd' }, error: null }),
    createCaseWithOnlineSubmission: vi.fn().mockResolvedValue({ caseId: null, error: retryErr }),
    getCaseIdByOnlineSubmissionId: vi.fn()
  }))

  vi.doMock('../../../src/messaging/outbound/received-event/publish-received-event.js', () => ({ publishReceivedEvent: vi.fn() }))

  const { createCaseWithOnlineSubmissionInCrm } = await import('../../../src/services/create-case-with-online-submission-in-crm.js')

  await expect(createCaseWithOnlineSubmissionInCrm({
    authToken: 't', crn: '123', sbi: '456', caseType: 'SomeType', caseData: {}, onlineSubmissionActivity: {}, correlationId: 'cid'
  })).rejects.toMatchObject({ message: 'CRM transient', retryable: true })

  // logger should have been called with the original case error
  expect(mockLogger.error).toHaveBeenCalledWith({
    error: retryErr,
    event: { category: 'retryable', reason: '{"error":{"code":"0x80060891"}}' }
  }, 'Error creating case with online submission activity')
})
