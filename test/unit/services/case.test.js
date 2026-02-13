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
  findByCorrelationId: vi.fn(),
  create: vi.fn()
}))

const { createCase, transformPayload } = await import('../../../src/services/case.js')
const { MONGO_DUPLICATE_KEY_ERROR_CODE } = await import('../../../src/constants/mongodb.js')
const { getCrmAuthToken } = await import('../../../src/auth/get-crm-auth-token.js')
const { createCaseWithOnlineSubmissionInCrm } = await import('../../../src/services/create-case-with-online-submission-in-crm.js')
const { findByCorrelationId, create } = await import('../../../src/repos/cases.js')

const validPayload = {
  data: {
    crn: 'crn1',
    sbi: 'sbi1',
    crm: { title: 'Test Title' },
    file: { fileName: 'file.pdf', url: 'http://file' },
    correlationId: 'corr-1'
  }
}

describe('case service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findByCorrelationId.mockResolvedValue(null)
    create.mockResolvedValue({ acknowledged: true })
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
    it('should create a new case in CRM and save mapping to MongoDB on first message', async () => {
      const response = await createCase(validPayload)

      expect(findByCorrelationId).toHaveBeenCalledWith('corr-1')
      expect(getCrmAuthToken).toHaveBeenCalled()
      expect(createCaseWithOnlineSubmissionInCrm).toHaveBeenCalledWith(
        expect.objectContaining({
          authToken: 'mock-token',
          crn: 'crn1',
          sbi: 'sbi1',
          correlationId: 'corr-1'
        })
      )
      expect(create).toHaveBeenCalledWith({ correlationId: 'corr-1', caseId: 'mock-case-id' })
      expect(response.caseId).toBe('mock-case-id')
    })

    it('should emit a minimal log when a new case is created', async () => {
      await createCase(validPayload)

      expect(mockLogger.info).toHaveBeenCalledWith(
        { correlationId: 'corr-1', caseId: 'mock-case-id' },
        'Case created'
      )
    })

    it('should not create a new case when correlationId already exists in MongoDB', async () => {
      findByCorrelationId.mockResolvedValue({
        correlationId: 'corr-1',
        caseId: 'existing-case-id',
        createdAt: new Date()
      })

      const response = await createCase(validPayload)

      expect(response).toEqual({ caseId: 'existing-case-id' })
      expect(getCrmAuthToken).not.toHaveBeenCalled()
      expect(createCaseWithOnlineSubmissionInCrm).not.toHaveBeenCalled()
      expect(create).not.toHaveBeenCalled()
      expect(mockLogger.info).toHaveBeenCalledWith(
        { caseId: 'existing-case-id' },
        'Skipped: case already exists'
      )
    })

    it('should not emit case.created event when correlationId already exists', async () => {
      findByCorrelationId.mockResolvedValue({
        correlationId: 'corr-1',
        caseId: 'existing-case-id',
        createdAt: new Date()
      })

      await createCase(validPayload)

      expect(createCaseWithOnlineSubmissionInCrm).not.toHaveBeenCalled()
    })

    it('should handle race condition via unique index (duplicate key error)', async () => {
      const duplicateError = new Error('E11000 duplicate key error')
      duplicateError.code = MONGO_DUPLICATE_KEY_ERROR_CODE
      create.mockRejectedValue(duplicateError)

      const response = await createCase(validPayload)

      expect(response).toEqual({ caseId: 'mock-case-id' })
      expect(mockLogger.info).toHaveBeenCalledWith(
        { correlationId: 'corr-1' },
        'Duplicate correlationId, case already saved by concurrent request'
      )
    })

    it('should not emit a creation log on duplicate key error', async () => {
      const duplicateError = new Error('E11000 duplicate key error')
      duplicateError.code = MONGO_DUPLICATE_KEY_ERROR_CODE
      create.mockRejectedValue(duplicateError)

      await createCase(validPayload)

      expect(mockLogger.info).not.toHaveBeenCalledWith(
        expect.objectContaining({ caseId: 'mock-case-id' }),
        'Case created'
      )
    })

    it('should propagate non-duplicate-key errors from MongoDB', async () => {
      const dbError = new Error('Connection lost')
      create.mockRejectedValue(dbError)

      await expect(createCase(validPayload)).rejects.toThrow('Connection lost')
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to create case via CRM API', dbError)
    })

    it('should log and throw when CRM API fails', async () => {
      const error = new Error('CRM unavailable')
      createCaseWithOnlineSubmissionInCrm.mockRejectedValue(error)

      await expect(createCase(validPayload)).rejects.toThrow('CRM unavailable')
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to create case via CRM API', error)
    })
  })
})
