import { describe, test, expect, vi, beforeEach } from 'vitest'
import { crmEvents } from '../../../src/constants/events.js'

const mockLogger = { error: vi.fn() }

vi.mock('../../../src/logging/logger.js', () => ({
  createLogger: () => mockLogger
}))

vi.mock('../../../src/repos/crm.js', () => ({
  getContactIdFromCrn: vi.fn(),
  getAccountIdFromSbi: vi.fn(),
  createMetadataForExistingCase: vi.fn(),
  getOnlineSubmissionIds: vi.fn(),
  createMetadataForOnlineSubmission: vi.fn()
}))

vi.mock('../../../src/messaging/outbound/received-event/publish-received-event.js', () => ({
  publishReceivedEvent: vi.fn()
}))

const { createMetadataForExistingCaseinCrm } = await import(
  '../../../src/services/create-metadata-for-existing-case.js'
)

const {
  getContactIdFromCrn,
  getAccountIdFromSbi,
  createMetadataForExistingCase
} = await import('../../../src/repos/crm.js')

const {
  publishReceivedEvent
} = await import('../../../src/messaging/outbound/received-event/publish-received-event.js')

describe('createMetadataForExistingCaseinCrm service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns caseId on success and publishes event', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'mock-contact-id' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: 'mock-account-id' })
    createMetadataForExistingCase.mockResolvedValue({ error: null })

    const request = {
      authToken: 'mock-token',
      crn: 'mock-crn',
      sbi: 'mock-sbi',
      caseId: 'mock-case-id',
      metadata: { key: 'value' },
      correlationId: 'mock-correlation-id'
    }

    const result = await createMetadataForExistingCaseinCrm(request)

    expect(getContactIdFromCrn).toHaveBeenCalledWith('mock-token', 'mock-crn')
    expect(getAccountIdFromSbi).toHaveBeenCalledWith('mock-token', 'mock-sbi')

    expect(createMetadataForExistingCase).toHaveBeenCalledWith({
      authToken: 'mock-token',
      caseId: 'mock-case-id',
      metadata: {
        key: 'value',
        contactId: 'mock-contact-id',
        accountId: 'mock-account-id'
      }
    })

    expect(publishReceivedEvent).toHaveBeenCalledWith({
      type: crmEvents.CASE_CREATED,
      data: {
        correlationId: 'mock-correlation-id'
      }
    })

    expect(result).toEqual({ caseId: 'mock-case-id' })
  })

  test('throws error if required parameter is missing', async () => {
    await expect(
      createMetadataForExistingCaseinCrm({
        authToken: null,
        crn: null,
        sbi: null,
        caseId: null,
        metadata: null,
        correlationId: null
      })
    ).rejects.toThrow('Missing required parameter: authToken')

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Missing required parameter: authToken'
    )
  })

  test('throws 422 if contact not found', async () => {
    getContactIdFromCrn.mockResolvedValue({
      contactId: null,
      error: 'Not found'
    })

    await expect(
      createMetadataForExistingCaseinCrm({
        authToken: 'mock-token',
        crn: 'mock-crn',
        sbi: 'mock-sbi',
        caseId: 'mock-case-id',
        metadata: {},
        correlationId: 'mock-correlation-id'
      })
    ).rejects.toMatchObject({
      isBoom: true,
      message: 'Contact ID not found',
      output: { statusCode: 422 }
    })

    expect(mockLogger.error).toHaveBeenCalledWith(
      'No contact found for CRN: mock-crn, error: Not found'
    )
  })

  test('throws 422 if account not found', async () => {
    getContactIdFromCrn.mockResolvedValue({
      contactId: 'mock-contact-id'
    })

    getAccountIdFromSbi.mockResolvedValue({
      accountId: null,
      error: 'Not found'
    })

    await expect(
      createMetadataForExistingCaseinCrm({
        authToken: 'mock-token',
        crn: 'mock-crn',
        sbi: 'mock-sbi',
        caseId: 'mock-case-id',
        metadata: {},
        correlationId: 'mock-correlation-id'
      })
    ).rejects.toMatchObject({
      isBoom: true,
      message: 'Account ID not found',
      output: { statusCode: 422 }
    })

    expect(mockLogger.error).toHaveBeenCalledWith(
      'No account found for SBI: mock-sbi, error: Not found'
    )
  })

  test('throws 500 if createMetadataForExistingCase returns error', async () => {
    getContactIdFromCrn.mockResolvedValue({
      contactId: 'mock-contact-id'
    })

    getAccountIdFromSbi.mockResolvedValue({
      accountId: 'mock-account-id'
    })

    createMetadataForExistingCase.mockResolvedValue({
      error: 'CRM failure'
    })

    await expect(
      createMetadataForExistingCaseinCrm({
        authToken: 'mock-token',
        crn: 'mock-crn',
        sbi: 'mock-sbi',
        caseId: 'mock-case-id',
        metadata: {},
        correlationId: 'mock-correlation-id'
      })
    ).rejects.toMatchObject({
      isBoom: true,
      message: 'Unable to create metadata for existing case in CRM',
      output: { statusCode: 500 }
    })

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Error creating metadata for existing case: CRM failure'
    )
  })
})
