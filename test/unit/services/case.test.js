import { describe, test, expect, vi, beforeEach } from 'vitest'
import Boom from '@hapi/boom'

const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
const mockEmitAuditEvent = vi.fn().mockResolvedValue(undefined)

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
  createMetadataForOnlineSubmission: vi.fn(),
  createIntegrationInboundQueueRecord: vi.fn()
}))

const mockConfigGet = vi.fn(() => '')

vi.mock('../../../src/config/index.js', () => ({
  config: {
    get: mockConfigGet
  }
}))

vi.mock('../../../src/api/common/helpers/metrics.js', () => ({
  metricsCounter: vi.fn()
}))

vi.mock('../../../src/messaging/outbound/audit/send-audit-event.js', () => ({
  emitAuditEvent: mockEmitAuditEvent
}))

const { createCase, transformPayload } = await import('../../../src/services/case.js')
const { getCrmAuthToken } = await import('../../../src/auth/get-crm-auth-token.js')
const { createCaseWithOnlineSubmissionInCrm, resolveDocumentTypeOrThrow } = await import('../../../src/services/create-case-with-online-submission-in-crm.js')
const { upsertCase, updateCaseId, markFileProcessed, claimCreatorRole, releaseCreator } = await import('../../../src/repos/cases.js')
const { getOnlineSubmissionActivityId, createMetadataForOnlineSubmission } = await import('../../../src/repos/crm.js')
const { createIntegrationInboundQueueRecord } = await import('../../../src/repos/crm.js')
const { metricsCounter } = await import('../../../src/api/common/helpers/metrics.js')
const { caseCreationMetrics } = await import('../../../src/constants/case-creation-metrics.js')
const { triageEventTypes } = await import('../../../src/constants/integration-inbound-triage.js')

const validPayload = {
  data: {
    crn: 'crn1',
    sbi: 'sbi1',
    crm: { title: 'Test Title' },
    file: { fileId: 'file-1', fileName: 'file.pdf', url: 'http://file', contentType: 'application/pdf' },
    correlationId: 'corr-1',
    filesInBatch: 3
  }
}

describe('case service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfigGet.mockReturnValue('')
    mockEmitAuditEvent.mockResolvedValue(undefined)
    upsertCase.mockResolvedValue({ isNew: true, isDuplicateFile: false, caseId: null, isCreator: true })
    updateCaseId.mockResolvedValue({ modifiedCount: 1 })
    markFileProcessed.mockResolvedValue({ modifiedCount: 1 })
    claimCreatorRole.mockResolvedValue(false)
    releaseCreator.mockResolvedValue(true)
    createCaseWithOnlineSubmissionInCrm.mockResolvedValue({ caseId: 'mock-case-id', contactId: 'c1', accountId: 'a1', rpaOnlinesubmissionid: 'mock-ols-id' })
    // mocks for additional-file flow
    getOnlineSubmissionActivityId.mockResolvedValue({ onlineSubmissionActivityId: '84c190b8-5d96-f111-8076-000d3ada3978', error: null })
    createMetadataForOnlineSubmission.mockResolvedValue({ metadataId: 'meta-1', error: null })
    createIntegrationInboundQueueRecord.mockResolvedValue({ triageRecordId: 'triage-1', created: true, error: null })
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

    test('should carry filesInBatch through to the transformed payload', () => {
      const payloadWithFiles = {
        data: {
          ...validPayload.data,
          filesInBatch: 3
        }
      }

      const result = transformPayload(payloadWithFiles)
      expect(result.filesInBatch).toBe(3)
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
          fileId: 'file-1',
          filesInBatch: expect.any(Number)
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

    test('should emit a document/created audit event with caseId after case creation (event 1)', async () => {
      await createCase(validPayload)

      expect(mockEmitAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
        correlationid: 'corr-1',
        audit: expect.objectContaining({
          entities: [{ entity: 'document', action: 'created', entityid: 'mock-case-id' }],
          accounts: { crn: 'crn1', sbi: 'sbi1' },
          status: 'success'
        })
      }))
    })

    // emitAuditEvent (the shared wrapper in send-audit-event.js) never
    // rejects by contract - that guarantee is proven directly in
    // send-audit-event.test.js, so a "still returns X when audit fails"
    // test is not repeated at this call site.

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
      expect(metricsCounter).toHaveBeenCalledWith(caseCreationMetrics.WAITING_FOR_CASE)
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
      expect(metricsCounter).toHaveBeenCalledWith(caseCreationMetrics.CREATOR_ROLE_CLAIMED)
    })

    test('should log a claimed creator role with ECS fields', async () => {
      upsertCase.mockResolvedValue({ isNew: false, isDuplicateFile: false, caseId: null, isCreator: false })
      claimCreatorRole.mockResolvedValue(true)

      await createCase(validPayload)

      expect(mockLogger.info).toHaveBeenCalledWith(
        {
          event: { type: caseCreationMetrics.CREATOR_ROLE_CLAIMED, action: 'claim_creator_role', category: 'crm', outcome: 'success', reference: 'corr-1' },
          tenant: { message: 'fileId=file-1' }
        },
        'Creator role reassigned to this file'
      )
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
      expect(metricsCounter).toHaveBeenCalledWith(caseCreationMetrics.CREATOR_ROLE_RELEASED)
      expect(mockLogger.info).toHaveBeenCalledWith(
        {
          event: { type: caseCreationMetrics.CREATOR_ROLE_RELEASED, action: 'release_creator_role', category: 'crm', outcome: 'success', reference: 'corr-1' },
          tenant: { message: 'fileId=file-1' }
        },
        'Creator role released after non-retryable failure'
      )
    })

    test('should not release the creator role when case creation fails retryably', async () => {
      const retryableErr = new Error('CRM unavailable, will retry')
      retryableErr.retryable = true
      createCaseWithOnlineSubmissionInCrm.mockRejectedValue(retryableErr)

      await createCase(validPayload).catch(e => e)

      expect(releaseCreator).not.toHaveBeenCalled()
      expect(metricsCounter).not.toHaveBeenCalledWith(caseCreationMetrics.CREATOR_ROLE_RELEASED)
      expect(createIntegrationInboundQueueRecord).not.toHaveBeenCalled()
    })

    test('should release the creator role when an error carries no retryable flag, since the consumer dead-letters it', async () => {
      createCaseWithOnlineSubmissionInCrm.mockRejectedValue(new Error('unexpected'))

      await createCase(validPayload).catch(e => e)

      expect(releaseCreator).toHaveBeenCalledWith('corr-1', 'file-1')
    })

    test('should release the creator role when contact/account lookup fails with a Boom error carrying no retryable flag', async () => {
      // Mirrors the real Boom 422 thrown by ensureContactAndAccount ("Contact
      // ID not found" / "Account ID not found"), which the consumer treats as
      // terminal (discardFailedMessage) despite never setting err.retryable.
      const contactErr = Boom.boomify(new Error('Contact ID not found'), { statusCode: 422 })
      createCaseWithOnlineSubmissionInCrm.mockRejectedValue(contactErr)

      const thrown = await createCase(validPayload).catch(e => e)

      expect(thrown.retryable).toBeUndefined()
      expect(releaseCreator).toHaveBeenCalledWith('corr-1', 'file-1')
    })

    test('should not triage a retryable failure even if it carries a mapped triage reason', async () => {
      const retryableErr = new Error('CRM unavailable, will retry')
      retryableErr.retryable = true
      retryableErr.triageFailureReason = 'document_type_not_found'
      createCaseWithOnlineSubmissionInCrm.mockRejectedValue(retryableErr)
      mockConfigGet.mockReturnValue('927350008')

      await createCase(validPayload).catch(() => {})

      expect(createIntegrationInboundQueueRecord).not.toHaveBeenCalled()
    })

    test('should log triage write skipped when a mapped terminal failure occurs but config is empty', async () => {
      const err = new Error('No document type metadata found for caseType: Document Upload')
      err.retryable = false
      err.triageFailureReason = 'document_type_not_found'
      createCaseWithOnlineSubmissionInCrm.mockRejectedValue(err)

      await createCase(validPayload).catch(() => {})

      expect(createIntegrationInboundQueueRecord).not.toHaveBeenCalled()
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          event: expect.objectContaining({
            type: triageEventTypes.WRITE_SKIPPED,
            action: 'skip_triage_record',
            reason: 'config_missing_or_empty'
          })
        }),
        'Skipping CRM triage record write because processing entity config is missing or empty'
      )
    })

    test('should write triage record when config is set and failure reason is mapped', async () => {
      const err = new Error('No document type metadata found for caseType: Document Upload')
      err.retryable = false
      err.triageFailureReason = 'document_type_not_found'
      const wrappedErr = new Error('Unable to create case with online submission activity in CRM')
      wrappedErr.retryable = false
      wrappedErr.triageFailureReason = 'document_type_not_found'
      wrappedErr.cause = err
      createCaseWithOnlineSubmissionInCrm.mockRejectedValue(wrappedErr)
      mockConfigGet.mockReturnValue('927350008')
      createIntegrationInboundQueueRecord.mockResolvedValue({
        triageRecordId: 'e5f31d07-a1c6-4067-a8ce-7695e1453d96',
        created: true,
        error: null
      })

      await createCase(validPayload).catch(() => {})

      expect(createIntegrationInboundQueueRecord).toHaveBeenCalledWith(expect.objectContaining({
        authToken: 'mock-token',
        correlationId: 'corr-1',
        failureReason: 'document_type_not_found',
        processingEntity: 927350008
      }))
      const triageWriteRequest = createIntegrationInboundQueueRecord.mock.calls[0][0]
      expect(JSON.parse(triageWriteRequest.errorDetails)).toEqual(expect.objectContaining({
        errorMessage: 'No document type metadata found for caseType: Document Upload'
      }))
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: expect.objectContaining({
            type: triageEventTypes.WRITE_SUCCEEDED,
            action: 'write_triage_record',
            outcome: 'success',
            reason: 'document_type_not_found',
            reference: 'e5f31d07-a1c6-4067-a8ce-7695e1453d96'
          })
        }),
        'CRM triage record write completed'
      )
    })

    test('should classify tagged contact lookup failures for triage and write record when config is set', async () => {
      const taggedContactErr = Boom.boomify(new Error('Contact ID not found'), { statusCode: 422 })
      taggedContactErr.triageFailureReason = 'contact_not_found_for_crn'
      createCaseWithOnlineSubmissionInCrm.mockRejectedValue(taggedContactErr)
      mockConfigGet.mockReturnValue('927350008')

      await createCase(validPayload).catch(() => {})

      expect(createIntegrationInboundQueueRecord).toHaveBeenCalledWith(expect.objectContaining({
        failureReason: 'contact_not_found_for_crn',
        processingEntity: 927350008
      }))
    })

    test('should trim processing entity config and log duplicate suppression when triage record already exists', async () => {
      const err = new Error('No document type metadata found for caseType: Document Upload')
      err.retryable = false
      err.triageFailureReason = 'document_type_not_found'
      createCaseWithOnlineSubmissionInCrm.mockRejectedValue(err)
      mockConfigGet.mockReturnValue(' 927350008 ')
      createIntegrationInboundQueueRecord.mockResolvedValue({
        triageRecordId: 'e5f31d07-a1c6-4067-a8ce-7695e1453d96',
        created: false,
        error: null
      })

      await createCase(validPayload).catch(() => {})

      expect(createIntegrationInboundQueueRecord).toHaveBeenCalledWith(expect.objectContaining({
        processingEntity: 927350008
      }))
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: expect.objectContaining({
            type: triageEventTypes.WRITE_SUCCEEDED,
            reason: 'duplicate_suppressed',
            reference: 'e5f31d07-a1c6-4067-a8ce-7695e1453d96'
          })
        }),
        'CRM triage record write completed'
      )
    })

    test('should not write triage record when terminal failure is not mapped to a triage reason', async () => {
      const err = new Error('Unexpected terminal failure')
      err.retryable = false
      err.retryMetadata = { category: 'non-retryable', terminalReason: 'some_other_reason' }
      createCaseWithOnlineSubmissionInCrm.mockRejectedValue(err)
      mockConfigGet.mockReturnValue('927350008')

      await createCase(validPayload).catch(() => {})

      expect(createIntegrationInboundQueueRecord).not.toHaveBeenCalled()
      expect(mockLogger.warn).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: expect.objectContaining({ type: triageEventTypes.WRITE_SKIPPED }) }),
        expect.any(String)
      )
    })

    test('should log triage write failed and preserve original terminal behavior when triage write errors', async () => {
      const err = new Error('No document type metadata found for caseType: Document Upload')
      err.retryable = false
      err.triageFailureReason = 'document_type_not_found'
      createCaseWithOnlineSubmissionInCrm.mockRejectedValue(err)
      mockConfigGet.mockReturnValue('927350008')

      const triageWriteError = new Error('Bad Request')
      triageWriteError.name = 'HttpError'
      triageWriteError.retryMetadata = { status: 400 }
      createIntegrationInboundQueueRecord.mockResolvedValue({
        triageRecordId: null,
        created: false,
        error: triageWriteError
      })

      const thrown = await createCase(validPayload).catch(e => e)

      expect(thrown).toBe(err)
      expect(releaseCreator).toHaveBeenCalledWith('corr-1', 'file-1')
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          event: expect.objectContaining({
            type: triageEventTypes.WRITE_FAILED,
            action: 'write_triage_record',
            outcome: 'failure',
            reason: 'document_type_not_found'
          }),
          error: expect.objectContaining({
            message: 'Bad Request',
            type: 'HttpError',
            code: 400
          })
        }),
        'CRM triage record write failed'
      )
    })

    test('should rethrow the original failure even when releasing the creator role itself fails', async () => {
      const nonRetryableErr = new Error('Unable to create case with online submission activity in CRM')
      nonRetryableErr.retryable = false
      createCaseWithOnlineSubmissionInCrm.mockRejectedValue(nonRetryableErr)
      releaseCreator.mockRejectedValue(new Error('MongoNetworkError: connection timed out'))

      const thrown = await createCase(validPayload).catch(e => e)

      expect(thrown).toBe(nonRetryableErr)
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          event: expect.objectContaining({ reason: 'creator_release_failed' })
        }),
        expect.stringContaining('Failed to release creator role')
      )
    })

    test('should count a failed release so the degraded path is alertable', async () => {
      const nonRetryableErr = new Error('Unable to create case with online submission activity in CRM')
      nonRetryableErr.retryable = false
      createCaseWithOnlineSubmissionInCrm.mockRejectedValue(nonRetryableErr)
      releaseCreator.mockRejectedValue(new Error('MongoNetworkError: connection timed out'))

      await createCase(validPayload).catch(e => e)

      expect(metricsCounter).toHaveBeenCalledWith(caseCreationMetrics.CREATOR_RELEASE_FAILED)
      expect(metricsCounter).not.toHaveBeenCalledWith(caseCreationMetrics.CREATOR_ROLE_RELEASED)
    })

    test('should not log or count a release when releaseCreator finds nothing to release', async () => {
      const nonRetryableErr = new Error('Unable to create case with online submission activity in CRM')
      nonRetryableErr.retryable = false
      createCaseWithOnlineSubmissionInCrm.mockRejectedValue(nonRetryableErr)
      releaseCreator.mockResolvedValue(false)

      await createCase(validPayload).catch(e => e)

      expect(releaseCreator).toHaveBeenCalledWith('corr-1', 'file-1')
      expect(metricsCounter).not.toHaveBeenCalledWith(caseCreationMetrics.CREATOR_ROLE_RELEASED)
      expect(mockLogger.info).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: expect.objectContaining({ type: caseCreationMetrics.CREATOR_ROLE_RELEASED }) }),
        expect.any(String)
      )
    })

    test('should not log or count a release when releaseCreator finds nothing to release', async () => {
      const nonRetryableErr = new Error('Unable to create case with online submission activity in CRM')
      nonRetryableErr.retryable = false
      createCaseWithOnlineSubmissionInCrm.mockRejectedValue(nonRetryableErr)
      releaseCreator.mockResolvedValue(false)

      await createCase(validPayload).catch(e => e)

      expect(releaseCreator).toHaveBeenCalledWith('corr-1', 'file-1')
      expect(metricsCounter).not.toHaveBeenCalledWith(caseCreationMetrics.CREATOR_ROLE_RELEASED)
      expect(mockLogger.info).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: expect.objectContaining({ type: caseCreationMetrics.CREATOR_ROLE_RELEASED }) }),
        expect.any(String)
      )
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

    test('should emit a document/created audit event with metadataId after metadata attachment (event 2)', async () => {
      upsertCase.mockResolvedValue({ isNew: false, isDuplicateFile: false, caseId: 'existing-case-id', isCreator: false })

      await createCase(validPayload)

      expect(mockEmitAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
        correlationid: 'corr-1',
        audit: expect.objectContaining({
          entities: [{ entity: 'document', action: 'created', entityid: 'meta-1' }],
          accounts: { crn: 'crn1', sbi: 'sbi1' },
          status: 'success'
        })
      }))
    })

    // See note above: emitAuditEvent's non-rejecting contract is proven in
    // send-audit-event.test.js.

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
