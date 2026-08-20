import { describe, test, expect, vi, beforeEach } from 'vitest'

const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

vi.mock('../../../src/logging/logger.js', () => ({
  createLogger: () => mockLogger
}))

vi.mock('../../../src/auth/get-crm-auth-token.js', () => ({
  getCrmAuthToken: vi.fn(async () => 'mock-token')
}))

vi.mock('../../../src/services/create-case-with-online-submission-in-crm.js', () => ({
  createCaseWithOnlineSubmissionInCrm: vi.fn(async () => ({ caseId: 'mock-case-id', contactId: 'c1', accountId: 'a1', rpaOnlinesubmissionid: 'mock-ols-id' })),
  resolveDocumentTypeOrThrow: vi.fn(async () => ({ schemeValue: 's', subjectValue: 'sub', documentTypesId: 'doc-type-guid' }))
}))

vi.mock('../../../src/repos/cases.js', () => ({
  upsertCase: vi.fn(),
  updateCaseId: vi.fn(),
  markFileProcessed: vi.fn(),
  claimCreatorRole: vi.fn(),
  releaseCreator: vi.fn()
}))

vi.mock('../../../src/repos/crm.js', () => ({
  getOnlineSubmissionActivityId: vi.fn(),
  createMetadataForOnlineSubmission: vi.fn()
}))

const { createCase, transformPayload } = await import('../../../src/services/case.js')
const { getCrmAuthToken } = await import('../../../src/auth/get-crm-auth-token.js')
const { createCaseWithOnlineSubmissionInCrm, resolveDocumentTypeOrThrow } = await import('../../../src/services/create-case-with-online-submission-in-crm.js')
const { upsertCase, updateCaseId, markFileProcessed, claimCreatorRole, releaseCreator } = await import('../../../src/repos/cases.js')
const { getOnlineSubmissionActivityId, createMetadataForOnlineSubmission } = await import('../../../src/repos/crm.js')

const validPayload = {
  data: {
    crn: 'crn1',
    sbi: 'sbi1',
    crm: { title: 'Test Title' },
    file: { fileId: 'file-1', fileName: 'file.pdf', url: 'http://file', contentType: 'application/pdf' },
    correlationId: 'corr-1'
  }
}

describe('case service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    upsertCase.mockResolvedValue({ isNew: true, isDuplicateFile: false, caseId: null, isCreator: true })
    updateCaseId.mockResolvedValue({ modifiedCount: 1 })
    markFileProcessed.mockResolvedValue({ modifiedCount: 1 })
    claimCreatorRole.mockResolvedValue(false)
    releaseCreator.mockResolvedValue(true)
    createCaseWithOnlineSubmissionInCrm.mockResolvedValue({ caseId: 'mock-case-id', contactId: 'c1', accountId: 'a1', rpaOnlinesubmissionid: 'mock-ols-id' })
    // mocks for additional-file flow
    getOnlineSubmissionActivityId.mockResolvedValue({ onlineSubmissionActivityId: '84c190b8-5d96-f111-8076-000d3ada3978', error: null })
    createMetadataForOnlineSubmission.mockResolvedValue({ metadataId: 'meta-1', error: null })
  })

  describe('transformPayload', () => {
    test('should transform a valid CloudEvents payload', () => {
      const result = transformPayload(validPayload)
      expect(result.crn).toBe('crn1')
      expect(result.sbi).toBe('sbi1')
      expect(result.caseData.title).toBe('Test Title')
      expect(result.caseData.caseDescription).toContain('file.pdf')
      expect(result.onlineSubmissionActivity.subject).toContain('file.pdf')
      expect(result.correlationId).toBe('corr-1')
    })

    test('should throw if data is missing', () => {
      expect(() => transformPayload({})).toThrow('Missing data property in CloudEvents payload')
    })

    test('should use fallback values when crm and file are missing or minimal', () => {
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
      expect(result.onlineSubmissionActivity.metadata.blobFileId).toBeNull()
    })

    test('should include mimeType when contentType is provided on file', () => {
      const payloadWithMime = {
        data: {
          crn: 'crn1',
          sbi: 'sbi1',
          crm: { title: 'Test Title' },
          file: { fileId: 'file-2', fileName: 'file.pdf', url: 'http://file', contentType: 'application/pdf' },
          correlationId: 'corr-2'
        }
      }

      const result = transformPayload(payloadWithMime)
      expect(result.onlineSubmissionActivity.metadata.mimeType).toBe('application/pdf')
    })

    test('should not include mimeType when file has no contentType', () => {
      const payloadWithoutMime = {
        data: {
          crn: 'crn1',
          sbi: 'sbi1',
          crm: { title: 'Test Title' },
          file: { fileId: 'file-3', fileName: 'file-no-mime.pdf', url: 'http://file' },
          correlationId: 'corr-3'
        }
      }

      const result = transformPayload(payloadWithoutMime)
      expect(result.onlineSubmissionActivity.metadata.mimeType).toBeNull()
    })
  })

  describe('createCase', () => {
    test('should create a new case in CRM when isNew is true (first message)', async () => {
      const response = await createCase(validPayload)

      expect(upsertCase).toHaveBeenCalledWith('corr-1', 'file-1')
      expect(getCrmAuthToken).toHaveBeenCalled()
      expect(createCaseWithOnlineSubmissionInCrm).toHaveBeenCalledWith(
        expect.objectContaining({
          authToken: 'mock-token',
          crn: 'crn1',
          sbi: 'sbi1',
          correlationId: 'corr-1',
          fileId: 'file-1'
        })
      )
      expect(updateCaseId).toHaveBeenCalledWith('corr-1', 'mock-case-id')
      expect(markFileProcessed).toHaveBeenCalledWith('corr-1', 'file-1')
      expect(response.caseId).toBe('mock-case-id')

      // metadata should include mimeType from the file
      expect(createCaseWithOnlineSubmissionInCrm).toHaveBeenCalledWith(
        expect.objectContaining({
          onlineSubmissionActivity: expect.objectContaining({
            metadata: expect.objectContaining({ mimeType: 'application/pdf' })
          })
        })
      )
    })

    test('should log when a new case is created with ECS fields', async () => {
      await createCase(validPayload)

      expect(mockLogger.info).toHaveBeenCalledWith(
        {
          event: { action: 'case-created', outcome: 'success', reference: 'mock-case-id' },
          tenant: { message: 'fileId=file-1 rpaOnlinesubmissionid=mock-ols-id contactId=c1 accountId=a1' }
        },
        'Case created'
      )
    })

    test('should retry case creation when creator retries after failure (isCreator, caseId null)', async () => {
      upsertCase.mockResolvedValue({ isNew: false, isDuplicateFile: false, caseId: null, isCreator: true })

      const response = await createCase(validPayload)

      expect(getCrmAuthToken).toHaveBeenCalled()
      expect(createCaseWithOnlineSubmissionInCrm).toHaveBeenCalled()
      expect(updateCaseId).toHaveBeenCalledWith('corr-1', 'mock-case-id')
      expect(markFileProcessed).toHaveBeenCalledWith('corr-1', 'file-1')
      expect(response.caseId).toBe('mock-case-id')
    })

    test('should skip processing when message is an exact duplicate (same correlationId + fileId)', async () => {
      upsertCase.mockResolvedValue({ isNew: false, isDuplicateFile: true, caseId: 'existing-case-id', isCreator: true })

      const response = await createCase(validPayload)

      expect(response).toEqual({ skipped: true, caseId: 'existing-case-id' })
      expect(getCrmAuthToken).not.toHaveBeenCalled()
      expect(createCaseWithOnlineSubmissionInCrm).not.toHaveBeenCalled()
      expect(mockLogger.info).toHaveBeenCalledWith(
        { tenant: { message: 'fileId=file-1' } },
        'Skipped: duplicate message'
      )
    })

    test('should throw retryable error when case creation is in progress and the claim is refused', async () => {
      upsertCase.mockResolvedValue({ isNew: false, isDuplicateFile: false, caseId: null, isCreator: false })
      claimCreatorRole.mockResolvedValue(false)

      await expect(createCase(validPayload)).rejects.toThrow('Case creation in progress for this correlationId')

      const thrownError = await createCase(validPayload).catch(e => e)
      expect(thrownError.retryable).toBe(true)

      expect(claimCreatorRole).toHaveBeenCalledWith('corr-1', 'file-1')
      expect(getCrmAuthToken).not.toHaveBeenCalled()
      expect(createCaseWithOnlineSubmissionInCrm).not.toHaveBeenCalled()
      expect(mockLogger.info).toHaveBeenCalledWith(
        { tenant: { message: 'fileId=file-1' } },
        'Case creation in progress, will retry'
      )
    })

    test('should create the case when a waiting file successfully claims the creator role', async () => {
      upsertCase.mockResolvedValue({ isNew: false, isDuplicateFile: false, caseId: null, isCreator: false })
      claimCreatorRole.mockResolvedValue(true)

      const response = await createCase(validPayload)

      expect(claimCreatorRole).toHaveBeenCalledWith('corr-1', 'file-1')
      expect(getCrmAuthToken).toHaveBeenCalled()
      expect(createCaseWithOnlineSubmissionInCrm).toHaveBeenCalled()
      expect(updateCaseId).toHaveBeenCalledWith('corr-1', 'mock-case-id')
      expect(markFileProcessed).toHaveBeenCalledWith('corr-1', 'file-1')
      expect(response.caseId).toBe('mock-case-id')
    })

    test('should not attempt a claim when the creator itself is retrying (isCreator, caseId null)', async () => {
      upsertCase.mockResolvedValue({ isNew: false, isDuplicateFile: false, caseId: null, isCreator: true })

      await createCase(validPayload)

      expect(claimCreatorRole).not.toHaveBeenCalled()
    })

    test('should propagate retryable error when fallback lookup fails (race condition scenario)', async () => {
      const retryableErr = new Error('CRM did not return a case ID and fallback lookup failed')
      retryableErr.retryable = true
      createCaseWithOnlineSubmissionInCrm.mockRejectedValue(retryableErr)

      const thrown = await createCase(validPayload).catch(e => e)
      expect(thrown.message).toBe('CRM did not return a case ID and fallback lookup failed')
      expect(thrown.retryable).toBe(true)
      expect(updateCaseId).not.toHaveBeenCalled()
      expect(markFileProcessed).not.toHaveBeenCalled()
    })

    test('should propagate CRM API errors', async () => {
      const error = new Error('CRM unavailable')
      createCaseWithOnlineSubmissionInCrm.mockRejectedValue(error)

      await expect(createCase(validPayload)).rejects.toThrow('CRM unavailable')
    })

    test('should release the creator role and rethrow when case creation fails non-retryably', async () => {
      const nonRetryableErr = new Error('Unable to create case with online submission activity in CRM')
      nonRetryableErr.retryable = false
      createCaseWithOnlineSubmissionInCrm.mockRejectedValue(nonRetryableErr)

      const thrown = await createCase(validPayload).catch(e => e)

      expect(thrown).toBe(nonRetryableErr)
      expect(releaseCreator).toHaveBeenCalledWith('corr-1', 'file-1')
      expect(updateCaseId).not.toHaveBeenCalled()
      expect(markFileProcessed).not.toHaveBeenCalled()
    })

    test('should not release the creator role when case creation fails retryably', async () => {
      const retryableErr = new Error('CRM unavailable, will retry')
      retryableErr.retryable = true
      createCaseWithOnlineSubmissionInCrm.mockRejectedValue(retryableErr)

      await createCase(validPayload).catch(e => e)

      expect(releaseCreator).not.toHaveBeenCalled()
    })

    test('should not release the creator role when an error carries no retryable flag', async () => {
      createCaseWithOnlineSubmissionInCrm.mockRejectedValue(new Error('unexpected'))

      await createCase(validPayload).catch(e => e)

      expect(releaseCreator).not.toHaveBeenCalled()
    })

    test('should release the creator role when document type resolution fails non-retryably before any write', async () => {
      const docTypeErr = new Error('No document type metadata found for caseType: Document Upload')
      docTypeErr.retryable = false
      createCaseWithOnlineSubmissionInCrm.mockRejectedValue(docTypeErr)

      await createCase(validPayload).catch(e => e)

      expect(releaseCreator).toHaveBeenCalledWith('corr-1', 'file-1')
    })

    test('should let a released creator role be reclaimed and create the case', async () => {
      const nonRetryableErr = new Error('Unable to create case with online submission activity in CRM')
      nonRetryableErr.retryable = false
      upsertCase.mockResolvedValueOnce({ isNew: true, isDuplicateFile: false, caseId: null, isCreator: true })
      createCaseWithOnlineSubmissionInCrm.mockRejectedValueOnce(nonRetryableErr)

      await createCase(validPayload).catch(e => e)
      expect(releaseCreator).toHaveBeenCalledWith('corr-1', 'file-1')

      upsertCase.mockResolvedValueOnce({ isNew: false, isDuplicateFile: false, caseId: null, isCreator: false })
      claimCreatorRole.mockResolvedValueOnce(true)
      createCaseWithOnlineSubmissionInCrm.mockResolvedValueOnce({ caseId: 'mock-case-id', contactId: 'c1', accountId: 'a1', rpaOnlinesubmissionid: 'mock-ols-id' })

      const secondFilePayload = {
        data: { ...validPayload.data, file: { ...validPayload.data.file, fileId: 'file-2' } }
      }
      const response = await createCase(secondFilePayload)

      expect(claimCreatorRole).toHaveBeenCalledWith('corr-1', 'file-2')
      expect(response.caseId).toBe('mock-case-id')
    })

    test('should propagate MongoDB errors from upsertCase', async () => {
      const dbError = new Error('Connection lost')
      upsertCase.mockRejectedValue(dbError)

      await expect(createCase(validPayload)).rejects.toThrow('Connection lost')
    })

    test('should not mark file processed if CRM case creation fails', async () => {
      createCaseWithOnlineSubmissionInCrm.mockRejectedValue(new Error('CRM down'))

      await expect(createCase(validPayload)).rejects.toThrow('CRM down')

      expect(markFileProcessed).not.toHaveBeenCalled()
    })

    test('should mark file processed', async () => {
      upsertCase.mockResolvedValue({ isNew: false, isDuplicateFile: false, caseId: 'existing-case-id', isCreator: false })

      await expect(createCase(validPayload)).resolves.toEqual({ caseId: 'existing-case-id' })

      expect(markFileProcessed).toHaveBeenCalledWith(
        'corr-1',
        'file-1'
      )
    })

    test('should throw if unable to retrieve online submission id', async () => {
      upsertCase.mockResolvedValue({ isNew: false, isDuplicateFile: false, caseId: 'existing-case-id', isCreator: false })
      getOnlineSubmissionActivityId.mockResolvedValue({ onlineSubmissionActivityId: null, error: 'Not found' })

      await expect(createCase(validPayload)).rejects.toThrow('Failed to retrieve online submission id')

      expect(markFileProcessed).not.toHaveBeenCalled()
    })

    test('should throw if creating metadata fails and not mark file processed', async () => {
      upsertCase.mockResolvedValue({ isNew: false, isDuplicateFile: false, caseId: 'existing-case-id', isCreator: false })
      getOnlineSubmissionActivityId.mockResolvedValue({ onlineSubmissionActivityId: '84c190b8-5d96-f111-8076-000d3ada3978', error: null })
      createMetadataForOnlineSubmission.mockResolvedValue({ metadataId: null, error: 'CRM failure' })

      await expect(createCase(validPayload)).rejects.toThrow('Failed to add metadata for additional file')

      expect(markFileProcessed).not.toHaveBeenCalled()
    })

    test('should resolve the document type and pass it through for an additional file', async () => {
      upsertCase.mockResolvedValue({ isNew: false, isDuplicateFile: false, caseId: 'existing-case-id', isCreator: false })
      getOnlineSubmissionActivityId.mockResolvedValue({ onlineSubmissionActivityId: '84c190b8-5d96-f111-8076-000d3ada3978', error: null })
      createMetadataForOnlineSubmission.mockResolvedValue({ metadataId: 'meta-1', error: null })

      await createCase(validPayload)

      expect(resolveDocumentTypeOrThrow).toHaveBeenCalledWith('mock-token', 'Document Upload')
      expect(createMetadataForOnlineSubmission).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ documentTypeId: 'doc-type-guid' }),
          correlationId: 'corr-1',
          fileId: 'file-1'
        })
      )
    })

    test('should log the metadata write with event.reference set to metadataId, not caseId', async () => {
      upsertCase.mockResolvedValue({ isNew: false, isDuplicateFile: false, caseId: 'existing-case-id', isCreator: false })
      getOnlineSubmissionActivityId.mockResolvedValue({ onlineSubmissionActivityId: '84c190b8-5d96-f111-8076-000d3ada3978', error: null })
      createMetadataForOnlineSubmission.mockResolvedValue({ metadataId: 'meta-1', error: null })

      await createCase(validPayload)

      expect(mockLogger.info).toHaveBeenCalledWith(
        {
          event: { reference: 'meta-1' },
          tenant: { message: 'fileId=file-1 caseId=existing-case-id' }
        },
        'Metadata added to existing case'
      )
    })

    test('should log a non-retryable metadata failure with fileId and onlineSubmissionActivityId in tenant.message', async () => {
      const nonRetryErr = new Error('Bad request')
      nonRetryErr.retryMetadata = { category: 'non-retryable', terminalReason: 'http_400', status: 400 }
      upsertCase.mockResolvedValue({ isNew: false, isDuplicateFile: false, caseId: 'existing-case-id', isCreator: false })
      getOnlineSubmissionActivityId.mockResolvedValue({ onlineSubmissionActivityId: '84c190b8-5d96-f111-8076-000d3ada3978', error: null })
      createMetadataForOnlineSubmission.mockResolvedValue({ metadataId: null, error: nonRetryErr })

      await createCase(validPayload).catch(() => {})

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant: { message: 'fileId=file-1 onlineSubmissionActivityId=84c190b8-5d96-f111-8076-000d3ada3978' }
        }),
        expect.any(String)
      )
    })

    test('should not create metadata when the document type cannot be resolved', async () => {
      const docTypeErr = new Error('No document type metadata found for caseType: Document Upload')
      docTypeErr.retryable = false
      upsertCase.mockResolvedValue({ isNew: false, isDuplicateFile: false, caseId: 'existing-case-id', isCreator: false })
      getOnlineSubmissionActivityId.mockResolvedValue({ onlineSubmissionActivityId: '84c190b8-5d96-f111-8076-000d3ada3978', error: null })
      resolveDocumentTypeOrThrow.mockRejectedValueOnce(docTypeErr)

      const thrown = await createCase(validPayload).catch(e => e)

      expect(thrown.retryable).toBe(false)
      expect(createMetadataForOnlineSubmission).not.toHaveBeenCalled()
      expect(markFileProcessed).not.toHaveBeenCalled()
    })

    test('should throw with retryable=true when metadata creation fails with a retryable HTTP error', async () => {
      const retryErr = new Error('Service unavailable')
      retryErr.retryMetadata = { category: 'retryable', terminalReason: 'http_503', status: 503 }
      upsertCase.mockResolvedValue({ isNew: false, isDuplicateFile: false, caseId: 'existing-case-id', isCreator: false })
      getOnlineSubmissionActivityId.mockResolvedValue({ onlineSubmissionActivityId: '84c190b8-5d96-f111-8076-000d3ada3978', error: null })
      createMetadataForOnlineSubmission.mockResolvedValue({ metadataId: null, error: retryErr })

      const thrown = await createCase(validPayload).catch(e => e)

      expect(thrown.retryable).toBe(true)
      expect(thrown.retryMetadata).toEqual(retryErr.retryMetadata)
      expect(thrown.message).toBe('Failed to add metadata for additional file')
      expect(markFileProcessed).not.toHaveBeenCalled()
    })

    test('should throw with retryable=false when metadata creation fails with a non-retryable HTTP error', async () => {
      const nonRetryErr = new Error('Bad request')
      nonRetryErr.retryMetadata = { category: 'non-retryable', terminalReason: 'http_400', status: 400 }
      upsertCase.mockResolvedValue({ isNew: false, isDuplicateFile: false, caseId: 'existing-case-id', isCreator: false })
      getOnlineSubmissionActivityId.mockResolvedValue({ onlineSubmissionActivityId: '84c190b8-5d96-f111-8076-000d3ada3978', error: null })
      createMetadataForOnlineSubmission.mockResolvedValue({ metadataId: null, error: nonRetryErr })

      const thrown = await createCase(validPayload).catch(e => e)

      expect(thrown.retryable).toBe(false)
      expect(thrown.message).toBe('Failed to add metadata for additional file')
      expect(markFileProcessed).not.toHaveBeenCalled()
    })

    test('should use fallback values for metadata name and fileUrl when file properties missing', async () => {
      upsertCase.mockResolvedValue({ isNew: false, isDuplicateFile: false, caseId: 'existing-case-id', isCreator: false })
      getOnlineSubmissionActivityId.mockResolvedValue({ onlineSubmissionActivityId: '84c190b8-5d96-f111-8076-000d3ada3978', error: null })
      createMetadataForOnlineSubmission.mockResolvedValue({ metadataId: 'meta-2', error: null })

      const payloadMissingFileProps = {
        data: {
          crn: 'crn1',
          sbi: 'sbi1',
          crm: { title: 'Test Title' },
          file: {}, // no fileName, url, fileId, or contentType
          correlationId: 'corr-2'
        }
      }

      await expect(createCase(payloadMissingFileProps)).resolves.toEqual({ caseId: 'existing-case-id' })

      expect(createMetadataForOnlineSubmission).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({ name: 'unknown', blobFileId: null, mimeType: null })
      }))

      expect(markFileProcessed).toHaveBeenCalledWith('corr-2', undefined)
    })
  })
})
