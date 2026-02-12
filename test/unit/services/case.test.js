import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockLogger = { info: vi.fn(), error: vi.fn() }

vi.mock('../../../src/logging/logger.js', () => ({
  createLogger: () => mockLogger
}))

vi.mock('../../../src/auth/get-crm-auth-token.js', () => ({
  getCrmAuthToken: vi.fn(async () => 'mock-token')
}))

vi.mock('../../../src/services/create-case-with-online-submission-in-crm.js', () => ({
  createCaseWithOnlineSubmissionInCrm: vi.fn(async () => ({ caseId: 'mock-case-id', contactId: 'c1', accountId: 'a1' }))
}))

vi.mock('../../../src/repos/cases.js', () => ({
  upsertCase: vi.fn(),
  updateCaseId: vi.fn(),
  markFileProcessed: vi.fn()
}))

vi.mock('../../../src/repos/crm.js', () => ({
  addMetadataToCase: vi.fn(async () => ({ activityId: 'mock-activity-id', error: null }))
}))

const { createCase, transformPayload } = await import('../../../src/services/case.js')
const { getCrmAuthToken } = await import('../../../src/auth/get-crm-auth-token.js')
const { createCaseWithOnlineSubmissionInCrm } = await import('../../../src/services/create-case-with-online-submission-in-crm.js')
const { upsertCase, updateCaseId, markFileProcessed } = await import('../../../src/repos/cases.js')
const { addMetadataToCase } = await import('../../../src/repos/crm.js')

const validPayload = {
  data: {
    crn: 'crn1',
    sbi: 'sbi1',
    crm: { title: 'Test Title' },
    file: { fileId: 'file-1', fileName: 'file.pdf', url: 'http://file' },
    correlationId: 'corr-1'
  }
}

describe('case service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    upsertCase.mockResolvedValue({ isNew: true, isDuplicateFile: false, caseId: null, isCreator: true })
    updateCaseId.mockResolvedValue({ modifiedCount: 1 })
    markFileProcessed.mockResolvedValue({ modifiedCount: 1 })
    createCaseWithOnlineSubmissionInCrm.mockResolvedValue({ caseId: 'mock-case-id', contactId: 'c1', accountId: 'a1' })
  })

  describe('transformPayload', () => {
    it('should transform a valid CloudEvents payload', () => {
      const result = transformPayload(validPayload)
      expect(result.crn).toBe('crn1')
      expect(result.sbi).toBe('sbi1')
      expect(result.caseData.title).toBe('Test Title')
      expect(result.caseData.caseDescription).toContain('file.pdf')
      expect(result.onlineSubmissionActivity.subject).toContain('file.pdf')
      expect(result.correlationId).toBe('corr-1')
    })

    it('should throw if data is missing', () => {
      expect(() => transformPayload({})).toThrow('Missing data property in CloudEvents payload')
    })

    it('should use fallback values when crm and file are missing or minimal', () => {
      const minimalPayload = {
        data: {
          crn: 'crn1',
          sbi: 'sbi1',
          correlationId: 'corr-1'
        }
      }
      const result = transformPayload(minimalPayload)

      expect(result.caseData.title).toBe('Document Upload')
      expect(result.caseData.caseDescription).toContain('Unknown file')
      expect(result.onlineSubmissionActivity.subject).toContain('Unknown')
      expect(result.onlineSubmissionActivity.description).toContain('Unknown file')
      expect(result.onlineSubmissionActivity.metadata.name).toBe('unknown')
      expect(result.onlineSubmissionActivity.metadata.fileUrl).toBe('')
    })
  })

  describe('createCase', () => {
    it('should create a new case in CRM when isNew is true (first message)', async () => {
      const response = await createCase(validPayload)

      expect(upsertCase).toHaveBeenCalledWith('corr-1', 'file-1')
      expect(getCrmAuthToken).toHaveBeenCalled()
      expect(createCaseWithOnlineSubmissionInCrm).toHaveBeenCalledWith(
        expect.objectContaining({
          authToken: 'mock-token',
          crn: 'crn1',
          sbi: 'sbi1',
          correlationId: 'corr-1'
        })
      )
      expect(updateCaseId).toHaveBeenCalledWith('corr-1', 'mock-case-id')
      expect(markFileProcessed).toHaveBeenCalledWith('corr-1', 'file-1')
      expect(response.caseId).toBe('mock-case-id')
    })

    it('should log when a new case is created', async () => {
      await createCase(validPayload)

      expect(mockLogger.info).toHaveBeenCalledWith(
        { correlationId: 'corr-1', caseId: 'mock-case-id' },
        'Case created'
      )
    })

    it('should retry case creation when creator retries after failure (isCreator, caseId null)', async () => {
      upsertCase.mockResolvedValue({ isNew: false, isDuplicateFile: false, caseId: null, isCreator: true })

      const response = await createCase(validPayload)

      expect(getCrmAuthToken).toHaveBeenCalled()
      expect(createCaseWithOnlineSubmissionInCrm).toHaveBeenCalled()
      expect(updateCaseId).toHaveBeenCalledWith('corr-1', 'mock-case-id')
      expect(markFileProcessed).toHaveBeenCalledWith('corr-1', 'file-1')
      expect(response.caseId).toBe('mock-case-id')
    })

    it('should skip processing when message is an exact duplicate (same correlationId + fileId)', async () => {
      upsertCase.mockResolvedValue({ isNew: false, isDuplicateFile: true, caseId: 'existing-case-id', isCreator: true })

      const response = await createCase(validPayload)

      expect(response).toEqual({ skipped: true })
      expect(getCrmAuthToken).not.toHaveBeenCalled()
      expect(createCaseWithOnlineSubmissionInCrm).not.toHaveBeenCalled()
      expect(addMetadataToCase).not.toHaveBeenCalled()
      expect(mockLogger.info).toHaveBeenCalledWith(
        { correlationId: 'corr-1', fileId: 'file-1' },
        'Skipped: duplicate message'
      )
    })

    it('should add metadata to existing case for a new file (different fileId, case created)', async () => {
      upsertCase.mockResolvedValue({ isNew: false, isDuplicateFile: false, caseId: 'existing-case-id', isCreator: false })

      const response = await createCase(validPayload)

      expect(getCrmAuthToken).toHaveBeenCalled()
      expect(createCaseWithOnlineSubmissionInCrm).not.toHaveBeenCalled()
      expect(addMetadataToCase).toHaveBeenCalledWith(
        expect.objectContaining({
          authToken: 'mock-token',
          caseId: 'existing-case-id',
          onlineSubmissionActivity: expect.objectContaining({
            subject: expect.stringContaining('file.pdf')
          })
        })
      )
      expect(markFileProcessed).toHaveBeenCalledWith('corr-1', 'file-1')
      expect(response).toEqual({ caseId: 'existing-case-id' })
      expect(mockLogger.info).toHaveBeenCalledWith(
        { correlationId: 'corr-1', caseId: 'existing-case-id', fileId: 'file-1' },
        'Metadata added to existing case'
      )
    })

    it('should throw retryable error when case creation is in progress by another message', async () => {
      upsertCase.mockResolvedValue({ isNew: false, isDuplicateFile: false, caseId: null, isCreator: false })

      await expect(createCase(validPayload)).rejects.toThrow('Case creation in progress for this correlationId')

      const thrownError = await createCase(validPayload).catch(e => e)
      expect(thrownError.retryable).toBe(true)

      expect(getCrmAuthToken).not.toHaveBeenCalled()
      expect(createCaseWithOnlineSubmissionInCrm).not.toHaveBeenCalled()
      expect(mockLogger.info).toHaveBeenCalledWith(
        { correlationId: 'corr-1', fileId: 'file-1' },
        'Case creation in progress, will retry'
      )
    })

    it('should propagate CRM API errors', async () => {
      const error = new Error('CRM unavailable')
      createCaseWithOnlineSubmissionInCrm.mockRejectedValue(error)

      await expect(createCase(validPayload)).rejects.toThrow('CRM unavailable')
    })

    it('should propagate MongoDB errors from upsertCase', async () => {
      const dbError = new Error('Connection lost')
      upsertCase.mockRejectedValue(dbError)

      await expect(createCase(validPayload)).rejects.toThrow('Connection lost')
    })

    it('should not mark file processed if CRM case creation fails', async () => {
      createCaseWithOnlineSubmissionInCrm.mockRejectedValue(new Error('CRM down'))

      await expect(createCase(validPayload)).rejects.toThrow('CRM down')

      expect(markFileProcessed).not.toHaveBeenCalled()
    })

    it('should not mark file processed if addMetadataToCase fails', async () => {
      upsertCase.mockResolvedValue({ isNew: false, isDuplicateFile: false, caseId: 'existing-case-id', isCreator: false })
      addMetadataToCase.mockRejectedValue(new Error('Metadata failed'))

      await expect(createCase(validPayload)).rejects.toThrow('Metadata failed')

      expect(markFileProcessed).not.toHaveBeenCalled()
    })
  })
})
