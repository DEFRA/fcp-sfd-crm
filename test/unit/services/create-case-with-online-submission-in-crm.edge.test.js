import { describe, it, expect, vi, beforeEach } from 'vitest'

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

const { createCaseWithOnlineSubmissionInCrm } = await import('../../../src/services/create-case-with-online-submission-in-crm.js')
const { getContactIdFromCrn, getAccountIdFromSbi, createCaseWithOnlineSubmission, getOnlineSubmissionId } = await import('../../../src/repos/crm.js')

describe('createCaseWithOnlineSubmissionInCrm edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should throw Boom badRequest for each missing required param', async () => {
    const base = {
      authToken: 't', crn: 'c', sbi: 's', caseData: {}, onlineSubmissionActivity: {}
    }
    for (const key of Object.keys(base)) {
      const req = { ...base, [key]: null }
      await expect(createCaseWithOnlineSubmissionInCrm(req)).rejects.toMatchObject({
        isBoom: true,
        message: expect.stringContaining('Missing required parameter:')
      })
    }
  })

  it('should throw Boom unprocessableEntity if contact/account not found', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: null, error: 'err' })
    await expect(createCaseWithOnlineSubmissionInCrm({
      authToken: 't',
      crn: 'c',
      sbi: 's',
      caseData: {},
      onlineSubmissionActivity: {},
      correlationId: 'test-correlation-id'
    }))
      .rejects.toMatchObject({ isBoom: true, message: expect.stringContaining('Contact ID not found') })
    getContactIdFromCrn.mockResolvedValue({ contactId: 'id' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: null, error: 'err' })
    await expect(createCaseWithOnlineSubmissionInCrm({
      authToken: 't',
      crn: 'c',
      sbi: 's',
      caseData: {},
      onlineSubmissionActivity: {},
      correlationId: 'test-correlation-id'
    }))
      .rejects.toMatchObject({ isBoom: true, message: expect.stringContaining('Account ID not found') })
  })

  it('should throw Boom internal if createCaseWithOnlineSubmission returns error', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'id' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: 'aid' })
    createCaseWithOnlineSubmission.mockResolvedValue({ caseId: null, error: 'fail' })
    await expect(createCaseWithOnlineSubmissionInCrm({
      authToken: 't',
      crn: 'c',
      sbi: 's',
      caseData: {},
      onlineSubmissionActivity: {},
      correlationId: 'test-correlation-id'
    }))
      .rejects.toMatchObject({ isBoom: true, message: expect.stringContaining('Unable to create case with online submission activity in CRM') })
  })

  it('should return all ids on success', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'id' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: 'aid' })
    createCaseWithOnlineSubmission.mockResolvedValue({ caseId: 'cid', error: null })
    getOnlineSubmissionId.mockResolvedValue({ rpaOnlinesubmissionid: 'ols-1', error: null })
    const result = await createCaseWithOnlineSubmissionInCrm({
      authToken: 't',
      crn: 'c',
      sbi: 's',
      caseData: {},
      onlineSubmissionActivity: {},
      correlationId: 'test-correlation-id'
    })
    expect(result).toEqual({ contactId: 'id', accountId: 'aid', caseId: 'cid', rpaOnlinesubmissionid: 'ols-1' })
  })
})
