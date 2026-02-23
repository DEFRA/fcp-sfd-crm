import { describe, test, expect, vi, beforeEach } from 'vitest'

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

describe('createMetadataForExistingCaseinCrm - edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const validRequest = {
    authToken: 'token',
    crn: 'crn',
    sbi: 'sbi',
    caseId: 'case-id',
    metadata: { foo: 'bar' },
    correlationId: 'corr-id'
  }

  // ---------------------------
  // Required param edge cases
  // ---------------------------

  test.each([
    ['authToken', ''],
    ['crn', ''],
    ['sbi', ''],
    ['caseId', ''],
    ['metadata', null],
    ['correlationId', '']
  ])('throws badRequest if %s is empty/falsy', async (field, value) => {
    const request = { ...validRequest, [field]: value }

    await expect(
      createMetadataForExistingCaseinCrm(request)
    ).rejects.toThrow(`Missing required parameter: ${field}`)

    expect(mockLogger.error).toHaveBeenCalledWith(
      `Missing required parameter: ${field}`
    )

    expect(getContactIdFromCrn).not.toHaveBeenCalled()
    expect(publishReceivedEvent).not.toHaveBeenCalled()
  })

  test('throws if parameter is undefined', async () => {
    const request = { ...validRequest }
    delete request.crn

    await expect(
      createMetadataForExistingCaseinCrm(request)
    ).rejects.toThrow('Missing required parameter: crn')

    expect(getContactIdFromCrn).not.toHaveBeenCalled()
  })

  test('treats numeric 0 as missing (falsy)', async () => {
    const request = { ...validRequest, caseId: 0 }

    await expect(
      createMetadataForExistingCaseinCrm(request)
    ).rejects.toThrow('Missing required parameter: caseId')
  })

  // ---------------------------
  // CRM lookup edge cases
  // ---------------------------

  test('throws 422 if contactId exists but error also present', async () => {
    getContactIdFromCrn.mockResolvedValue({
      contactId: 'valid-id',
      error: 'Unexpected error'
    })

    await expect(
      createMetadataForExistingCaseinCrm(validRequest)
    ).rejects.toMatchObject({
      isBoom: true,
      message: 'Contact ID not found',
      output: { statusCode: 422 }
    })

    expect(publishReceivedEvent).not.toHaveBeenCalled()
  })

  test('throws 422 if accountId exists but error also present', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'contact-id' })

    getAccountIdFromSbi.mockResolvedValue({
      accountId: 'account-id',
      error: 'Unexpected error'
    })

    await expect(
      createMetadataForExistingCaseinCrm(validRequest)
    ).rejects.toMatchObject({
      isBoom: true,
      message: 'Account ID not found',
      output: { statusCode: 422 }
    })

    expect(createMetadataForExistingCase).not.toHaveBeenCalled()
    expect(publishReceivedEvent).not.toHaveBeenCalled()
  })

  // ---------------------------
  // Metadata behaviour
  // ---------------------------

  test('overrides contactId and accountId if already present in metadata', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'real-contact' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: 'real-account' })
    createMetadataForExistingCase.mockResolvedValue({ error: null })

    const request = {
      ...validRequest,
      metadata: {
        contactId: 'fake-contact',
        accountId: 'fake-account',
        extra: 'value'
      }
    }

    await createMetadataForExistingCaseinCrm(request)

    expect(createMetadataForExistingCase).toHaveBeenCalledWith({
      authToken: 'token',
      caseId: 'case-id',
      metadata: {
        contactId: 'real-contact',
        accountId: 'real-account',
        extra: 'value'
      }
    })
  })

  test('does not publish event if metadata creation fails', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'contact-id' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: 'account-id' })
    createMetadataForExistingCase.mockResolvedValue({
      error: 'CRM failure'
    })

    await expect(
      createMetadataForExistingCaseinCrm(validRequest)
    ).rejects.toThrow()

    expect(publishReceivedEvent).not.toHaveBeenCalled()
  })
})
