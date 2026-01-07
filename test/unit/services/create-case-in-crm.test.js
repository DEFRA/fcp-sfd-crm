import { describe, test, expect, vi, beforeEach } from 'vitest'

const mockLogger = {
  error: vi.fn()
}

vi.mock('../../../src/logging/logger.js', () => ({
  createLogger: () => mockLogger
}))

vi.mock('../../../src/repos/crm.js', () => ({
  getContactIdFromCrn: vi.fn(),
  getAccountIdFromSbi: vi.fn(),
  createCase: vi.fn()
}))

const { createCaseInCrm } = await import('../../../src/services/create-case-in-crm.js')
const { getContactIdFromCrn, getAccountIdFromSbi, createCase } = await import('../../../src/repos/crm.js')

describe('createCaseInCrm service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('returns contactId, accountId, and caseId on success', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'mock-contact-id' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: 'mock-account-id' })
    createCase.mockResolvedValue({ caseId: 'mock-case-id', error: null })

    const result = await createCaseInCrm({
      authToken: 'mock-bearer-token',
      crn: 'mock-crn',
      sbi: 'mock-sbi'
    })

    expect(getContactIdFromCrn).toHaveBeenCalledWith('mock-bearer-token', 'mock-crn')
    expect(getAccountIdFromSbi).toHaveBeenCalledWith('mock-bearer-token', 'mock-sbi')
    expect(createCase).toHaveBeenCalledWith('mock-bearer-token', 'mock-contact-id', 'mock-account-id')

    expect(result).toEqual({
      contactId: 'mock-contact-id',
      accountId: 'mock-account-id',
      caseId: 'mock-case-id'
    })
  })

  test('throws error if authentication token, crn or sbi is missing', async () => {
    await expect(
      createCaseInCrm({
        authToken: null,
        crn: null,
        sbi: null
      })
    ).rejects.toThrow('Missing required parameters: authToken, crn, sbi')

    expect(mockLogger.error).toHaveBeenCalledWith('Missing required parameters: authToken, crn, sbi')

    expect(getContactIdFromCrn).not.toHaveBeenCalled()
    expect(getAccountIdFromSbi).not.toHaveBeenCalled()
    expect(createCase).not.toHaveBeenCalled()
  })

  test('throws error if contact not found', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: null, error: 'Not found' })

    await expect(
      createCaseInCrm({
        authToken: 'mock-bearer-token',
        crn: 'mock-crn',
        sbi: 'mock-sbi'
      })
    ).rejects.toThrow('Contact ID not found')

    expect(mockLogger.error).toHaveBeenCalledWith('No contact found for CRN: mock-crn, error: Not found')
  })

  test('throws error if account not found', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'mock-contact-id' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: null, error: 'Not found' })

    await expect(
      createCaseInCrm({ authToken: 'mock-bearer-token', crn: 'mock-crn', sbi: 'mock-sbi' })
    ).rejects.toThrow('Account ID not found')

    expect(mockLogger.error).toHaveBeenCalledWith('No account found for SBI: mock-sbi, error: Not found')
  })

  test('throws error if createCase returns error', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'mock-contact-id' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: 'mock-account-id' })
    createCase.mockResolvedValue({ caseId: null, error: 'CRM service failed' })

    await expect(
      createCaseInCrm({
        authToken: 'mock-bearer-token',
        crn: 'mock-crn',
        sbi: 'mock-sbi'
      })
    ).rejects.toThrow('Unable to create case in CRM')

    expect(mockLogger.error).toHaveBeenCalledWith('Error creating case: CRM service failed')
  })
})
