import { describe, test, expect, vi, beforeEach } from 'vitest'
import { crmEvents } from '../../../src/constants/events.js'

const mockLogger = { error: vi.fn() }

vi.mock('../../../src/logging/logger.js', () => ({
  createLogger: () => mockLogger
}))

vi.mock('../../../src/repos/crm.js', () => ({
  getContactIdFromCrn: vi.fn(),
  getAccountIdFromSbi: vi.fn(),
  createCaseWithOnlineSubmission: vi.fn(),
  getOnlineSubmissionId: vi.fn(),
  createMetadataForOnlineSubmission: vi.fn()
}))

vi.mock('../../../src/messaging/outbound/received-event/publish-received-event.js', () => ({
  publishReceivedEvent: vi.fn()
}))

const { createCaseWithOnlineSubmissionInCrm } = await import('../../../src/services/create-case-with-online-submission-in-crm.js')
const { getContactIdFromCrn, getAccountIdFromSbi, createCaseWithOnlineSubmission, getOnlineSubmissionId } = await import('../../../src/repos/crm.js')
const { publishReceivedEvent } = await import('../../../src/messaging/outbound/received-event/publish-received-event.js')

describe('createCaseWithOnlineSubmissionInCrm service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns contactId, accountId, and caseId on success', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'mock-contact-id' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: 'mock-account-id' })
    createCaseWithOnlineSubmission.mockResolvedValue({ caseId: 'mock-case-id', error: null })
    getOnlineSubmissionId.mockResolvedValue({ rpaOnlinesubmissionid: 'mock-ols-id', error: null })

    const request = {
      authToken: 'mock-bearer-token',
      correlationId: 'mock-correlation-id',
      crn: 'mock-crn',
      sbi: 'mock-sbi',
      caseData: { title: 'Test Case', caseDescription: 'Test description' },
      onlineSubmissionActivity: { subject: 'Test', description: 'Test submission' }
    }

    const result = await createCaseWithOnlineSubmissionInCrm(request)

    expect(getContactIdFromCrn).toHaveBeenCalledWith('mock-bearer-token', 'mock-crn')
    expect(getAccountIdFromSbi).toHaveBeenCalledWith('mock-bearer-token', 'mock-sbi')

    expect(createCaseWithOnlineSubmission).toHaveBeenCalledWith({
      authToken: 'mock-bearer-token',
      case: { ...request.caseData, contactId: 'mock-contact-id', accountId: 'mock-account-id' },
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
    createCaseWithOnlineSubmission.mockResolvedValue({ caseId: 'mock-case-id', error: null })

    const request = {
      authToken: 'mock-bearer-token',
      correlationId: 'mock-correlation-id',
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

    expect(mockLogger.error).toHaveBeenCalledWith('No contact found for CRN: mock-crn, error: Not found')
  })

  test('throws error if account not found', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'mock-contact-id' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: null, error: 'Not found' })

    await expect(
      createCaseWithOnlineSubmissionInCrm({
        authToken: 'mock-bearer-token',
        correlationId: 'mock-correlation-id',
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
    createCaseWithOnlineSubmission.mockResolvedValue({ caseId: null, error: 'CRM service failed' })

    await expect(createCaseWithOnlineSubmissionInCrm({
      authToken: 'mock-bearer-token',
      correlationId: 'mock-correlation-id',
      crn: 'mock-crn',
      sbi: 'mock-sbi',
      caseData: {},
      onlineSubmissionActivity: {}
    })).rejects.toThrow('Unable to create case with online submission activity in CRM')

    expect(mockLogger.error).toHaveBeenCalledWith(
      { correlationId: 'mock-correlation-id', error: 'CRM service failed' },
      'Error creating case with online submission activity'
    )
  })

  test('throws error if unable to retrieve online submission id', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'mock-contact-id' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: 'mock-account-id' })
    createCaseWithOnlineSubmission.mockResolvedValue({ caseId: 'mock-case-id', error: null })
    getOnlineSubmissionId.mockResolvedValue({ rpaOnlinesubmissionid: null, error: 'Not found' })

    await expect(createCaseWithOnlineSubmissionInCrm({
      authToken: 'mock-bearer-token',
      correlationId: 'mock-correlation-id',
      crn: 'mock-crn',
      sbi: 'mock-sbi',
      caseData: { title: 'Test Case', caseDescription: 'Test description' },
      onlineSubmissionActivity: { subject: 'Test', description: 'Test submission' }
    })).rejects.toThrow('Unable to retrieve online submission for created case')
  })
})

test('re-throws original retryable CRM error when createCaseWithOnlineSubmission reports retryable', async () => {
  vi.resetModules()
  const mockLogger = { error: vi.fn() }
  vi.doMock('../../../src/logging/logger.js', () => ({ createLogger: () => mockLogger }))

  const retryErr = new Error('CRM transient')
  retryErr.retryMetadata = { category: 'retryable', status: 503 }

  vi.doMock('../../../src/repos/crm.js', () => ({
    getContactIdFromCrn: vi.fn().mockResolvedValue({ contactId: 'c1' }),
    getAccountIdFromSbi: vi.fn().mockResolvedValue({ accountId: 'a1' }),
    createCaseWithOnlineSubmission: vi.fn().mockResolvedValue({ caseId: null, error: retryErr }),
    getOnlineSubmissionId: vi.fn().mockResolvedValue({ rpaOnlinesubmissionid: 'ol-1', error: null })
  }))

  vi.doMock('../../../src/messaging/outbound/received-event/publish-received-event.js', () => ({ publishReceivedEvent: vi.fn() }))

  const { createCaseWithOnlineSubmissionInCrm } = await import('../../../src/services/create-case-with-online-submission-in-crm.js')

  await expect(createCaseWithOnlineSubmissionInCrm({
    authToken: 't', crn: '123', sbi: '456', caseData: {}, onlineSubmissionActivity: {}, correlationId: 'cid'
  })).rejects.toMatchObject({ message: 'CRM transient', retryable: true })

  // logger should have been called with the original case error
  expect(mockLogger.error).toHaveBeenCalledWith({ correlationId: 'cid', error: retryErr }, 'Error creating case with online submission activity')
})

test('re-throws retryable error from fetchRpaOnlineSubmissionIdOrThrow preserving retryable flag', async () => {
  vi.resetModules()
  const mockLogger = { error: vi.fn() }
  vi.doMock('../../../src/logging/logger.js', () => ({ createLogger: () => mockLogger }))

  const thrownErr = new Error('RPA transient')
  thrownErr.retryMetadata = { category: 'retryable', status: 502 }

  vi.doMock('../../../src/repos/crm.js', () => ({
    getContactIdFromCrn: vi.fn().mockResolvedValue({ contactId: 'c1' }),
    getAccountIdFromSbi: vi.fn().mockResolvedValue({ accountId: 'a1' }),
    createCaseWithOnlineSubmission: vi.fn().mockResolvedValue({ caseId: 'case-1', error: null }),
    getOnlineSubmissionId: vi.fn().mockResolvedValue({ rpaOnlinesubmissionid: 'ol-1', error: null })
  }))

  // mock the helper that fetches RPA id to throw the retryable error
  vi.doMock('../../../src/services/crm-helpers.js', () => ({
    assertRequiredParams: vi.fn(),
    ensureContactAndAccount: vi.fn().mockResolvedValue({ contactId: 'c1', accountId: 'a1' }),
    fetchRpaOnlineSubmissionIdOrThrow: vi.fn().mockRejectedValue(thrownErr)
  }))

  vi.doMock('../../../src/messaging/outbound/received-event/publish-received-event.js', () => ({ publishReceivedEvent: vi.fn() }))

  const { createCaseWithOnlineSubmissionInCrm } = await import('../../../src/services/create-case-with-online-submission-in-crm.js')

  await expect(createCaseWithOnlineSubmissionInCrm({
    authToken: 't', crn: '123', sbi: '456', caseData: {}, onlineSubmissionActivity: {}, correlationId: 'cid'
  })).rejects.toMatchObject({ message: 'RPA transient', retryable: true })

  expect(mockLogger.error).toHaveBeenCalledWith({ caseId: 'case-1', error: thrownErr }, 'Unable to retrieve online submission id')
})
