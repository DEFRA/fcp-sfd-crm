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
  getOnlineSubmissionId: vi.fn(),
  createMetadataForOnlineSubmission: vi.fn()
}))

const { createCase, transformPayload } = await import('../../../src/services/case.js')
const { getCrmAuthToken } = await import('../../../src/auth/get-crm-auth-token.js')
const { createCaseWithOnlineSubmissionInCrm } = await import('../../../src/services/create-case-with-online-submission-in-crm.js')
const { upsertCase, updateCaseId, markFileProcessed } = await import('../../../src/repos/cases.js')
const { getOnlineSubmissionId, createMetadataForOnlineSubmission } = await import('../../../src/repos/crm.js')

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
    // mocks for additional-file flow
    getOnlineSubmissionId.mockResolvedValue({ rpaOnlinesubmissionid: 'ols-1', error: null })
    createMetadataForOnlineSubmission.mockResolvedValue({ metadataId: 'meta-1', error: null })
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
      expect(mockLogger.info).toHaveBeenCalledWith(
        { correlationId: 'corr-1', fileId: 'file-1' },
        'Skipped: duplicate message'
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

    it('should mark file processed', async () => {
      upsertCase.mockResolvedValue({ isNew: false, isDuplicateFile: false, caseId: 'existing-case-id', isCreator: false })

      await expect(createCase(validPayload)).resolves.toEqual({ caseId: 'existing-case-id' })

      expect(markFileProcessed).toHaveBeenCalledWith(
        'corr-1',
        'file-1'
      )
    })

    it('should throw if unable to retrieve online submission id', async () => {
      upsertCase.mockResolvedValue({ isNew: false, isDuplicateFile: false, caseId: 'existing-case-id', isCreator: false })
      getOnlineSubmissionId.mockResolvedValue({ rpaOnlinesubmissionid: null, error: 'Not found' })

      await expect(createCase(validPayload)).rejects.toThrow('Failed to retrieve online submission id')

      expect(markFileProcessed).not.toHaveBeenCalled()
    })

    it('should throw if creating metadata fails and not mark file processed', async () => {
      upsertCase.mockResolvedValue({ isNew: false, isDuplicateFile: false, caseId: 'existing-case-id', isCreator: false })
      getOnlineSubmissionId.mockResolvedValue({ rpaOnlinesubmissionid: 'ols-1', error: null })
      createMetadataForOnlineSubmission.mockResolvedValue({ metadataId: null, error: 'CRM failure' })

      await expect(createCase(validPayload)).rejects.toThrow('Failed to add metadata for additional file')

      expect(markFileProcessed).not.toHaveBeenCalled()
    })

    it('should use fallback values for metadata name and fileUrl when file properties missing', async () => {
      upsertCase.mockResolvedValue({ isNew: false, isDuplicateFile: false, caseId: 'existing-case-id', isCreator: false })
      getOnlineSubmissionId.mockResolvedValue({ rpaOnlinesubmissionid: 'ols-1', error: null })
      createMetadataForOnlineSubmission.mockResolvedValue({ metadataId: 'meta-2', error: null })

      const payloadMissingFileProps = {
        data: {
          crn: 'crn1',
          sbi: 'sbi1',
          crm: { title: 'Test Title' },
          file: { fileId: 'file-2' }, // no fileName or url
          correlationId: 'corr-2'
        }
      }

      await expect(createCase(payloadMissingFileProps)).resolves.toEqual({ caseId: 'existing-case-id' })

      expect(createMetadataForOnlineSubmission).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({ name: 'unknown', fileUrl: '' })
      }))

      expect(markFileProcessed).toHaveBeenCalledWith('corr-2', 'file-2')
    })
  })
})
