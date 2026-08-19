import { describe, test, expect, vi, beforeEach } from 'vitest'
import { HttpError } from '@fetchkit/ffetch'

const mockHttpClient = vi.fn()
const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

vi.mock('../../../src/http/client.js', () => ({
  httpClient: mockHttpClient
}))

vi.mock('../../../src/logging/logger.js', () => ({
  createLogger: () => mockLogger
}))

// Mock config
vi.mock('../../../src/config/index.js', () => ({
  config: {
    get: vi.fn((key) => {
      if (key === 'crm.baseUrl') return 'https://crm.example.com/api'
      if (key === 'crm.caseOriginCode') return 3
      return null
    })
  }
}))

// Import after mocks
const { getContactIdFromCrn, getAccountIdFromSbi, createCaseWithOnlineSubmission, getDocumentTypeMetadata, deriveMetadataRecordId } = await import('../../../src/repos/crm.js')

const DOC_TYPE_ID = '4e88916b-aae2-ee11-904c-000d3adc1ec9'
const ACTIVITY_ID = '84c190b8-5d96-f111-8076-000d3ada3978'
const CORRELATION_ID = 'correlation-abc'
const FILE_ID = 'file-1'

describe('CRM repository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getContactIdFromCrn', () => {
    test('should fetch contact by CRN and return contactId', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          value: [{ contactid: '6ff3f89f-efe6-f455-fff6-bfff1f808e6' }]
        })
      }
      mockHttpClient.mockResolvedValue(mockResponse)

      const result = await getContactIdFromCrn('Bearer token', '1234567890')

      expect(mockHttpClient).toHaveBeenCalledWith(
        "https://crm.example.com/api/contacts?%24select=contactid&%24filter=rpa_capcustomerid%20eq%20'1234567890'",
        {
          method: 'GET',
          headers: { Authorization: 'Bearer token', Prefer: 'return=representation', 'Content-Type': 'application/json' }
        }
      )
      expect(result).toEqual({ contactId: '6ff3f89f-efe6-f455-fff6-bfff1f808e6' })
    })

    test('should return first contact when multiple results', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          value: [
            { contactid: '6ff3f89f-efe6-f455-fff6-bfff1f808e6' },
            { contactid: '2ee2e78e-ded5-e344-eef5-afff0f797d5' }
          ]
        })
      }
      mockHttpClient.mockResolvedValue(mockResponse)

      const result = await getContactIdFromCrn('Bearer token', '1234567890')

      expect(result).toEqual({ contactId: '6ff3f89f-efe6-f455-fff6-bfff1f808e6' })
    })

    test('should handle fetch error for SBI and return error message', async () => {
      const mockError = new Error('Network error')
      mockHttpClient.mockRejectedValue(mockError)

      const result = await getContactIdFromCrn('Bearer token', '1234567890')

      expect(result.contactId).toBeNull()
      expect(result.error).toBeInstanceOf(Error)
      expect(result.error.message).toBe('Network error')
    })

    test('should handle JSON parsing error for SBI and return error message', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockRejectedValue(new Error('Invalid JSON'))
      }
      mockHttpClient.mockResolvedValue(mockResponse)

      const result = await getContactIdFromCrn('Bearer token', '1234567890')

      expect(result.contactId).toBeNull()
      expect(result.error).toBeInstanceOf(Error)
      expect(result.error.message).toBe('Invalid JSON')
    })
  })

  describe('getAccountIdFromSbi', () => {
    test('should fetch account by SBI and return accountId', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          value: [{ accountid: '7dd1d67d-cdc4-f233-ddf4-9efe9e686c4' }]
        })
      }
      mockHttpClient.mockResolvedValue(mockResponse)

      const result = await getAccountIdFromSbi('Bearer token', '987654321')

      expect(mockHttpClient).toHaveBeenCalledWith(
        "https://crm.example.com/api/accounts?%24select=accountid&%24filter=rpa_sbinumber%20eq%20'987654321'",
        {
          method: 'GET',
          headers: { Authorization: 'Bearer token', Prefer: 'return=representation', 'Content-Type': 'application/json' }
        }
      )
      expect(result).toEqual({ accountId: '7dd1d67d-cdc4-f233-ddf4-9efe9e686c4' })
    })

    test('should return first account when multiple results', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          value: [
            { accountid: '7dd1d67d-cdc4-f233-ddf4-9efe9e686c4' },
            { accountid: '3cc9c56c-bcb3-e122-cce3-8dfed5575b3' }
          ]
        })
      }
      mockHttpClient.mockResolvedValue(mockResponse)

      const result = await getAccountIdFromSbi('Bearer token', '987654321')

      expect(result).toEqual({ accountId: '7dd1d67d-cdc4-f233-ddf4-9efe9e686c4' })
    })

    test('should handle fetch error for CRN and return error message', async () => {
      const mockError = new Error('Network error')
      mockHttpClient.mockRejectedValue(mockError)

      const result = await getAccountIdFromSbi('Bearer token', '987654321')

      expect(result.accountId).toBeNull()
      expect(result.error).toBeInstanceOf(Error)
      expect(result.error.message).toBe('Network error')
    })

    test('should handle JSON parsing error for CRN and return error message', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockRejectedValue(new Error('Invalid JSON'))
      }
      mockHttpClient.mockResolvedValue(mockResponse)

      const result = await getAccountIdFromSbi('Bearer token', '987654321')

      expect(result.accountId).toBeNull()
      expect(result.error).toBeInstanceOf(Error)
      expect(result.error.message).toBe('Invalid JSON')
    })
  })

  describe('createCaseWithOnlineSubmission', () => {
    test('should create case with online submission activity using correct payload and return caseId', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          incidentid: '8bb8b45b-aba2-f011-bbd2-7ced8d4645a2'
        })
      }

      mockHttpClient.mockResolvedValue(mockResponse)

      const request = {
        authToken: 'Bearer token',
        case: {
          title: 'Test case title',
          caseDescription: 'Test case description',
          contactId: 'contact-123',
          accountId: 'account-456',
          documentTypeMetadata: {
            schemeValue: 'scheme-abc',
            subjectValue: 'subject-def',
            teamRoutingValue: 'team-ghi',
            documentTypesId: 'doctype-789'
          }
        },
        onlineSubmissionActivity: {
          subject: 'Test submission subject',
          description: 'Test submission description',
          scheduledStart: '2026-01-01T10:00:00Z',
          scheduledEnd: '2026-01-01T11:00:00Z',
          stateCode: 0,
          statusCode: 1,
          metadata: {
            name: 'test-document.pdf',
            documentType: 'doc-type-789',
            blobFileId: 'blob-file-id-123',
            mimeType: 'application/pdf'
          }
        }
      }

      const { caseId, rpaOnlinesubmissionid, error } = await createCaseWithOnlineSubmission(request)

      expect(mockHttpClient).toHaveBeenCalledWith(
        'https://crm.example.com/api/incidents',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer token',
            'Content-Type': 'application/json',
            Prefer: 'return=representation'
          },
          body: expect.any(String)
        }
      )

      const payload = JSON.parse(mockHttpClient.mock.calls[0][1].body)

      expect(payload).toMatchObject({
        title: 'Test case title',
        description: 'Test case description',
        caseorigincode: 3,
        prioritycode: 2,
        'customerid_contact@odata.bind': '/contacts(contact-123)',
        'rpa_Contact@odata.bind': '/contacts(contact-123)',
        'rpa_Organisation@odata.bind': '/accounts(account-456)',
        'rpa_Scheme@odata.bind': '/rpa_schemes(scheme-abc)',
        'subjectid@odata.bind': '/subjects(subject-def)',
        'ownerid@odata.bind': '/teams(team-ghi)',
        rpa_isunknowncontact: false,
        rpa_isunknownorganisation: false
      })

      expect(payload.incident_rpa_onlinesubmissions).toHaveLength(1)

      const submission = payload.incident_rpa_onlinesubmissions[0]

      expect(submission).toMatchObject({
        subject: 'Test submission subject',
        description: 'Test submission description',
        scheduledstart: '2026-01-01T10:00:00Z',
        scheduledend: '2026-01-01T11:00:00Z',
        rpa_onlinesubmissionid: expect.any(String),
        statecode: 0,
        statuscode: 1,
        'rpa_SubmissionType_rpa_onlinesubmission@odata.bind': '/rpa_documenttypeses(doctype-789)'
      })

      expect(submission.rpa_onlinesubmissionid).toHaveLength(20)

      expect(submission.rpa_onlinesubmission_rpa_activitymetadata[0]).toEqual({
        rpa_name: 'test-document.pdf',
        rpa_blobfileid: 'blob-file-id-123',
        'rpa_DocumentTypeMetaId@odata.bind': '/rpa_documenttypeses(doctype-789)',
        rpa_filemimetype: 'application/pdf'
      })

      expect(caseId).toBe('8bb8b45b-aba2-f011-bbd2-7ced8d4645a2')
      expect(rpaOnlinesubmissionid).toHaveLength(20)
      expect(submission.rpa_onlinesubmissionid).toBe(rpaOnlinesubmissionid)
      expect(error).toBeNull()
    })

    test('should omit rpa_filemimetype when mimeType not provided in createCaseWithOnlineSubmission', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ incidentid: '8bb8b45b-aba2-f011-bbd2-7ced8d4645a2' })
      }

      mockHttpClient.mockResolvedValue(mockResponse)

      const request = {
        authToken: 'Bearer token',
        case: {
          title: 'Test case title',
          caseDescription: 'Test case description',
          contactId: 'contact-123',
          accountId: 'account-456',
          documentTypeMetadata: {
            schemeValue: 'scheme-abc',
            subjectValue: 'subject-def',
            documentTypesId: 'doctype-789'
          }
        },
        onlineSubmissionActivity: {
          subject: 'Test submission subject',
          description: 'Test submission description',
          scheduledStart: '2026-01-01T10:00:00Z',
          scheduledEnd: '2026-01-01T11:00:00Z',
          stateCode: 0,
          statusCode: 1,
          metadata: {
            name: 'test-document.pdf',
            documentType: 'doc-type-789',
            blobFileId: 'blob-file-id-123'
          }
        }
      }

      await createCaseWithOnlineSubmission(request)

      const payload = JSON.parse(mockHttpClient.mock.calls[0][1].body)
      const submission = payload.incident_rpa_onlinesubmissions[0]
      const meta = submission.rpa_onlinesubmission_rpa_activitymetadata[0]
      expect(meta.rpa_filemimetype).toBeUndefined()
      expect(payload['ownerid@odata.bind']).toBeUndefined()
    })

    test('should return error when fetch throws', async () => {
      mockHttpClient.mockRejectedValue(new Error('Network error'))

      const { caseId, error } = await createCaseWithOnlineSubmission({
        authToken: 'Bearer token',
        case: {
          title: 'Test',
          caseDescription: 'Test',
          contactId: 'contact-123',
          accountId: 'account-456',
          documentTypeMetadata: {
            schemeValue: 'scheme-abc',
            subjectValue: 'subject-def',
            documentTypesId: 'doctype-789'
          }
        },
        onlineSubmissionActivity: {
          subject: 'Subject',
          description: 'Description',
          scheduledStart: '2026-01-01T10:00:00Z',
          scheduledEnd: '2026-01-01T11:00:00Z',
          stateCode: 0,
          statusCode: 1,
          metadata: {
            name: 'file.pdf',
            documentType: 'doc-type',
            blobFileId: 'blob-1'
          }
        }
      })

      expect(caseId).toBeNull()
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('Network error')
    })

    test('should attach CRM error body when thrown error carries a response cause', async () => {
      const httpError = new Error('HTTP error: 400 Bad Request')
      httpError.cause = {
        text: vi.fn().mockResolvedValue('{"error":{"code":"0x80040265","message":"Cannot find record to be updated"}}')
      }
      mockHttpClient.mockRejectedValue(httpError)

      const { caseId, error } = await createCaseWithOnlineSubmission({
        authToken: '******',
        case: {
          title: 'Test',
          caseDescription: 'Test',
          contactId: 'contact-123',
          accountId: 'account-456',
          documentTypeMetadata: {
            schemeValue: 'scheme-abc',
            subjectValue: 'subject-def',
            documentTypesId: 'doctype-789'
          }
        },
        onlineSubmissionActivity: {
          subject: 'Subject',
          description: 'Description',
          scheduledStart: '2026-01-01T10:00:00Z',
          scheduledEnd: '2026-01-01T11:00:00Z',
          stateCode: 0,
          statusCode: 1,
          metadata: { name: 'file.pdf', documentType: 'doc-type', blobFileId: 'blob-1' }
        }
      })

      expect(caseId).toBeNull()
      expect(error.crmError).toBe('{"error":{"code":"0x80040265","message":"Cannot find record to be updated"}}')
    })

    test('should cap truncated CRM error body at the configured max length', async () => {
      const CRM_ERROR_BODY_MAX_LENGTH = 2000
      const httpError = new Error('HTTP error: 400 Bad Request')
      httpError.cause = { text: vi.fn().mockResolvedValue('a'.repeat(CRM_ERROR_BODY_MAX_LENGTH + 500)) }
      mockHttpClient.mockRejectedValue(httpError)

      const { caseId, error } = await createCaseWithOnlineSubmission({
        authToken: '******',
        case: {
          title: 'Test',
          caseDescription: 'Test',
          contactId: 'contact-123',
          accountId: 'account-456',
          documentTypeMetadata: {
            schemeValue: 'scheme-abc',
            subjectValue: 'subject-def',
            documentTypesId: 'doctype-789'
          }
        },
        onlineSubmissionActivity: {
          subject: 'Subject',
          description: 'Description',
          scheduledStart: '2026-01-01T10:00:00Z',
          scheduledEnd: '2026-01-01T11:00:00Z',
          stateCode: 0,
          statusCode: 1,
          metadata: { name: 'file.pdf', documentType: 'doc-type', blobFileId: 'blob-1' }
        }
      })

      expect(caseId).toBeNull()
      expect(error.crmError.length).toBe(CRM_ERROR_BODY_MAX_LENGTH)
      expect(error.crmError.endsWith('... (truncated)')).toBe(true)
    })

    test('should swallow body read failures when attaching CRM error body', async () => {
      const httpError = new Error('HTTP error: 400 Bad Request')
      httpError.cause = { text: vi.fn().mockRejectedValue(new Error('already consumed')) }
      mockHttpClient.mockRejectedValue(httpError)

      const { caseId, error } = await createCaseWithOnlineSubmission({
        authToken: '******',
        case: {
          title: 'Test',
          caseDescription: 'Test',
          contactId: 'contact-123',
          accountId: 'account-456',
          documentTypeMetadata: {
            schemeValue: 'scheme-abc',
            subjectValue: 'subject-def',
            documentTypesId: 'doctype-789'
          }
        },
        onlineSubmissionActivity: {
          subject: 'Subject',
          description: 'Description',
          scheduledStart: '2026-01-01T10:00:00Z',
          scheduledEnd: '2026-01-01T11:00:00Z',
          stateCode: 0,
          statusCode: 1,
          metadata: { name: 'file.pdf', documentType: 'doc-type', blobFileId: 'blob-1' }
        }
      })

      expect(caseId).toBeNull()
      expect(error.crmError).toBeUndefined()
    })

    test('should return error when response json parsing fails', async () => {
      mockHttpClient.mockResolvedValue({
        ok: true,
        json: vi.fn().mockRejectedValue(new Error('Invalid JSON'))
      })

      const { caseId, error } = await createCaseWithOnlineSubmission({
        authToken: 'Bearer token',
        case: {
          title: 'Test',
          caseDescription: 'Test',
          contactId: 'contact-123',
          accountId: 'account-456',
          documentTypeMetadata: {
            schemeValue: 'scheme-abc',
            subjectValue: 'subject-def',
            documentTypesId: 'doctype-789'
          }
        },
        onlineSubmissionActivity: {
          subject: 'Subject',
          description: 'Description',
          scheduledStart: '2026-01-01T10:00:00Z',
          scheduledEnd: '2026-01-01T11:00:00Z',
          stateCode: 0,
          statusCode: 1,
          metadata: {
            name: 'file.pdf',
            documentType: 'doc-type',
            blobFileId: 'blob-1'
          }
        }
      })

      expect(caseId).toBeNull()
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toBe('Invalid JSON')
    })
  })

  describe('getOnlineSubmissionActivityId', () => {
    test('should fetch online submission activity id for case', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ incident_rpa_onlinesubmissions: [{ activityid: '84c190b8-5d96-f111-8076-000d3ada3978', rpa_onlinesubmissionid: '45f08e57040f77977a63' }] })
      }
      mockHttpClient.mockResolvedValue(mockResponse)

      const { getOnlineSubmissionActivityId } = await import('../../../src/repos/crm.js')

      const result = await getOnlineSubmissionActivityId('******', 'case-123')

      expect(mockHttpClient).toHaveBeenCalledWith(
        'https://crm.example.com/api/incidents(case-123)?%24select=incidentid,title&%24expand=incident_rpa_onlinesubmissions(%24select=activityid,rpa_onlinesubmissionid)',
        {
          method: 'GET',
          headers: { Authorization: '******', Prefer: 'return=representation', 'Content-Type': 'application/json' }
        }
      )

      expect(result).toEqual({ onlineSubmissionActivityId: '84c190b8-5d96-f111-8076-000d3ada3978', error: null })
    })

    test('should return error when fetch fails', async () => {
      mockHttpClient.mockRejectedValue(new Error('Network error'))
      const { getOnlineSubmissionActivityId } = await import('../../../src/repos/crm.js')
      const result = await getOnlineSubmissionActivityId('******', 'case-123')
      expect(result.onlineSubmissionActivityId).toBeNull()
      expect(result.error).toBeInstanceOf(Error)
      expect(result.error.message).toBe('Network error')
    })

    test('should handle empty online submissions array', async () => {
      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({ incident_rpa_onlinesubmissions: [] }) }
      mockHttpClient.mockResolvedValue(mockResponse)
      const { getOnlineSubmissionActivityId } = await import('../../../src/repos/crm.js')
      const result = await getOnlineSubmissionActivityId('******', 'case-123')
      expect(result).toEqual({ onlineSubmissionActivityId: null, error: null })
    })
  })

  describe('createMetadataForOnlineSubmission', () => {
    test('should upsert metadata by its derived key and return metadataId without reading the response body', async () => {
      mockHttpClient.mockResolvedValue({ ok: true, status: 204 })

      const { createMetadataForOnlineSubmission } = await import('../../../src/repos/crm.js')
      const expectedId = deriveMetadataRecordId(CORRELATION_ID, FILE_ID)

      const result = await createMetadataForOnlineSubmission({
        authToken: '******',
        onlineSubmissionActivityId: ACTIVITY_ID,
        metadata: { name: 'file.pdf', blobFileId: 'blob-1', documentTypeId: DOC_TYPE_ID, mimeType: 'application/pdf' },
        correlationId: CORRELATION_ID,
        fileId: FILE_ID
      })

      expect(result).toEqual({ metadataId: expectedId, error: null })
      const lastCall = mockHttpClient.mock.calls[0]
      expect(lastCall[0]).toBe(`https://crm.example.com/api/rpa_activitymetadatas(${expectedId})`)
      expect(lastCall[1].method).toBe('PATCH')
      expect(lastCall[1].headers['If-None-Match']).toBe('*')
      const body = JSON.parse(lastCall[1].body)
      expect(body.rpa_filemimetype).toBe('application/pdf')
      expect(body['rpa_RelatedOnlineSubmissionId@odata.bind']).toBe(`/rpa_onlinesubmissions(${ACTIVITY_ID})`)
    })

    test('should derive the same record id for the same correlationId and fileId, and a different one when either changes', () => {
      const first = deriveMetadataRecordId(CORRELATION_ID, FILE_ID)
      const repeat = deriveMetadataRecordId(CORRELATION_ID, FILE_ID)
      const differentFile = deriveMetadataRecordId(CORRELATION_ID, 'file-2')
      const differentCorrelation = deriveMetadataRecordId('correlation-xyz', FILE_ID)

      expect(repeat).toBe(first)
      expect(differentFile).not.toBe(first)
      expect(differentCorrelation).not.toBe(first)
      expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    })

    test('should omit rpa_filemimetype when mimeType not provided in createMetadataForOnlineSubmission', async () => {
      mockHttpClient.mockResolvedValue({ ok: true, status: 204 })
      const { createMetadataForOnlineSubmission } = await import('../../../src/repos/crm.js')

      const result = await createMetadataForOnlineSubmission({
        authToken: '******',
        onlineSubmissionActivityId: ACTIVITY_ID,
        metadata: { name: 'file.pdf', blobFileId: 'blob-1', documentTypeId: DOC_TYPE_ID },
        correlationId: CORRELATION_ID,
        fileId: FILE_ID
      })

      expect(result.error).toBeNull()
      const lastCall = mockHttpClient.mock.calls[0]
      const body = JSON.parse(lastCall[1].body)
      expect(body.rpa_filemimetype).toBeUndefined()
    })

    test('should return error when the request fails with a non-412 error', async () => {
      mockHttpClient.mockRejectedValue(new Error('Network error'))
      const { createMetadataForOnlineSubmission } = await import('../../../src/repos/crm.js')
      const result = await createMetadataForOnlineSubmission({
        authToken: '******',
        onlineSubmissionActivityId: ACTIVITY_ID,
        metadata: { documentTypeId: DOC_TYPE_ID },
        correlationId: CORRELATION_ID,
        fileId: FILE_ID
      })
      expect(result.metadataId).toBeNull()
      expect(result.error).toBeInstanceOf(Error)
      expect(result.error.message).toBe('Network error')
    })

    test('should treat a 412 response as success and log the suppressed duplicate', async () => {
      const httpError = new HttpError('HTTP error: 412 Precondition Failed', {
        status: 412,
        text: vi.fn().mockResolvedValue('')
      })
      mockHttpClient.mockRejectedValue(httpError)

      const { createMetadataForOnlineSubmission } = await import('../../../src/repos/crm.js')
      const expectedId = deriveMetadataRecordId(CORRELATION_ID, FILE_ID)

      const result = await createMetadataForOnlineSubmission({
        authToken: '******',
        onlineSubmissionActivityId: ACTIVITY_ID,
        metadata: { name: 'file.pdf', blobFileId: 'blob-1', documentTypeId: DOC_TYPE_ID },
        correlationId: CORRELATION_ID,
        fileId: FILE_ID
      })

      expect(result).toEqual({ metadataId: expectedId, error: null })
      expect(mockLogger.info).toHaveBeenCalledWith(
        { fileId: FILE_ID, metadataId: expectedId },
        'Metadata record already exists, duplicate write suppressed'
      )
    })

    test('should still fail as a non-retryable error for a 409 or other 4xx response', async () => {
      const httpError = new HttpError('HTTP error: 409 Conflict', {
        status: 409,
        text: vi.fn().mockResolvedValue('{"error":{"message":"conflict"}}')
      })
      mockHttpClient.mockRejectedValue(httpError)

      const { createMetadataForOnlineSubmission } = await import('../../../src/repos/crm.js')

      const result = await createMetadataForOnlineSubmission({
        authToken: '******',
        onlineSubmissionActivityId: ACTIVITY_ID,
        metadata: { name: 'file.pdf', blobFileId: 'blob-1', documentTypeId: DOC_TYPE_ID },
        correlationId: CORRELATION_ID,
        fileId: FILE_ID
      })

      expect(result.metadataId).toBeNull()
      expect(result.error).toBe(httpError)
      expect(mockLogger.info).not.toHaveBeenCalled()
    })

    test('should not suppress a 412 carried by an error that is not an HttpError', async () => {
      // Guards the narrowness of the suppression: only a genuine HTTP 412 from
      // the client counts. An unrelated error that happens to carry a similar
      // shape must still be reported. The real 500-then-412 retry sequence is
      // exercised against the unmocked client in crm-metadata-upsert-seam.test.js.
      const lookalike = new Error('not an HTTP error')
      lookalike.cause = { status: 412, text: vi.fn().mockResolvedValue('') }
      mockHttpClient.mockRejectedValue(lookalike)

      const { createMetadataForOnlineSubmission } = await import('../../../src/repos/crm.js')

      const result = await createMetadataForOnlineSubmission({
        authToken: '******',
        onlineSubmissionActivityId: ACTIVITY_ID,
        metadata: { name: 'file.pdf', blobFileId: 'blob-1', documentTypeId: DOC_TYPE_ID },
        correlationId: CORRELATION_ID,
        fileId: FILE_ID
      })

      expect(result.metadataId).toBeNull()
      expect(result.error).toBe(lookalike)
      expect(mockLogger.info).not.toHaveBeenCalled()
    })

    test.each([
      ['correlationId', { correlationId: undefined, fileId: FILE_ID }],
      ['fileId', { correlationId: CORRELATION_ID, fileId: null }],
      ['both identifiers', { correlationId: undefined, fileId: undefined }]
    ])('should refuse to derive a key when %s is missing, without calling the CRM API', async (_label, ids) => {
      const { createMetadataForOnlineSubmission } = await import('../../../src/repos/crm.js')

      const result = await createMetadataForOnlineSubmission({
        authToken: '******',
        onlineSubmissionActivityId: ACTIVITY_ID,
        metadata: { name: 'file.pdf', blobFileId: 'blob-1', documentTypeId: DOC_TYPE_ID },
        ...ids
      })

      expect(result.metadataId).toBeNull()
      expect(result.error).toBeInstanceOf(Error)
      expect(result.error.message).toContain('Cannot derive a stable metadata key')
      expect(mockHttpClient).not.toHaveBeenCalled()
    })

    test('should include provided documentTypeId in payload', async () => {
      mockHttpClient.mockResolvedValue({ ok: true, status: 204 })
      const { createMetadataForOnlineSubmission } = await import('../../../src/repos/crm.js')

      const result = await createMetadataForOnlineSubmission({
        authToken: '******',
        onlineSubmissionActivityId: ACTIVITY_ID,
        metadata: { name: 'file.pdf', blobFileId: 'blob-1', documentTypeId: DOC_TYPE_ID },
        correlationId: CORRELATION_ID,
        fileId: FILE_ID
      })

      expect(result.error).toBeNull()
      const lastCall = mockHttpClient.mock.calls[0]
      const body = JSON.parse(lastCall[1].body)
      expect(body['rpa_DocumentTypeMetaId@odata.bind']).toBe(`/rpa_documenttypeses(${DOC_TYPE_ID})`)
    })

    test('should reject a missing documentTypeId without calling the CRM API', async () => {
      const { createMetadataForOnlineSubmission } = await import('../../../src/repos/crm.js')

      const result = await createMetadataForOnlineSubmission({
        authToken: '******',
        onlineSubmissionActivityId: ACTIVITY_ID,
        metadata: { name: 'file.pdf', blobFileId: 'blob-1', documentTypeId: null },
        correlationId: CORRELATION_ID,
        fileId: FILE_ID
      })

      expect(result.metadataId).toBeNull()
      expect(result.error).toBeInstanceOf(Error)
      expect(result.error.message).toContain('Invalid documentTypeId')
      expect(mockHttpClient).not.toHaveBeenCalled()
    })

    test('should reject a non-GUID documentTypeId without calling the CRM API', async () => {
      const { createMetadataForOnlineSubmission } = await import('../../../src/repos/crm.js')

      const result = await createMetadataForOnlineSubmission({
        authToken: '******',
        onlineSubmissionActivityId: ACTIVITY_ID,
        metadata: { name: 'file.pdf', blobFileId: 'blob-1', documentTypeId: 'not-a-guid' },
        correlationId: CORRELATION_ID,
        fileId: FILE_ID
      })

      expect(result.metadataId).toBeNull()
      expect(result.error).toBeInstanceOf(Error)
      expect(result.error.message).toContain('Invalid documentTypeId')
      expect(mockHttpClient).not.toHaveBeenCalled()
    })

    test('should reject a non-GUID onlineSubmissionActivityId without calling the CRM API', async () => {
      const { createMetadataForOnlineSubmission } = await import('../../../src/repos/crm.js')

      const result = await createMetadataForOnlineSubmission({
        authToken: '******',
        onlineSubmissionActivityId: '45f08e57040f77977a63',
        metadata: { name: 'file.pdf', blobFileId: 'blob-1', documentTypeId: DOC_TYPE_ID },
        correlationId: CORRELATION_ID,
        fileId: FILE_ID
      })

      expect(result.metadataId).toBeNull()
      expect(result.error).toBeInstanceOf(Error)
      expect(result.error.message).toContain('Invalid onlineSubmissionActivityId')
      expect(mockHttpClient).not.toHaveBeenCalled()
    })

    test('should reject a missing onlineSubmissionActivityId without calling the CRM API', async () => {
      const { createMetadataForOnlineSubmission } = await import('../../../src/repos/crm.js')

      const result = await createMetadataForOnlineSubmission({
        authToken: '******',
        onlineSubmissionActivityId: null,
        metadata: { name: 'file.pdf', blobFileId: 'blob-1', documentTypeId: DOC_TYPE_ID },
        correlationId: CORRELATION_ID,
        fileId: FILE_ID
      })

      expect(result.metadataId).toBeNull()
      expect(result.error).toBeInstanceOf(Error)
      expect(result.error.message).toContain('Invalid onlineSubmissionActivityId')
      expect(mockHttpClient).not.toHaveBeenCalled()
    })
  })

  describe('getDocumentTypeMetadata', () => {
    test('should return document type metadata for valid caseType', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          value: [{
            _rpa_scheme_value: 'd7655ccd-4c2d-ef11-840a-000d3ab4c5e3',
            _rpa_subject_value: '4e1910c7-b0d7-ee11-904d-0022489fd23c',
            _rpa_teamrouting_value: 'a1b2c3d4-1234-5678-90ab-cdef12345678',
            rpa_documenttypesid: 'fe2785b9-f06e-f111-ab0c-7c1e5235c19d'
          }]
        })
      }
      mockHttpClient.mockResolvedValue(mockResponse)

      const result = await getDocumentTypeMetadata('Bearer token', 'CS_Agreement_Evidence')

      expect(mockHttpClient).toHaveBeenCalledWith(
        "https://crm.example.com/api/rpa_documenttypeses?%24select=_rpa_scheme_value,_rpa_subject_value,_rpa_teamrouting_value,rpa_documenttypesid&%24filter=rpa_documenttype%20eq%20'CS_Agreement_Evidence'",
        {
          method: 'GET',
          headers: { Authorization: 'Bearer token', Prefer: 'return=representation', 'Content-Type': 'application/json' }
        }
      )
      expect(result).toEqual({
        documentTypeMetadata: {
          schemeValue: 'd7655ccd-4c2d-ef11-840a-000d3ab4c5e3',
          subjectValue: '4e1910c7-b0d7-ee11-904d-0022489fd23c',
          teamRoutingValue: 'a1b2c3d4-1234-5678-90ab-cdef12345678',
          documentTypesId: 'fe2785b9-f06e-f111-ab0c-7c1e5235c19d'
        },
        error: null
      })
    })

    test('should return null documentTypeMetadata when no results found', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ value: [] })
      }
      mockHttpClient.mockResolvedValue(mockResponse)

      const result = await getDocumentTypeMetadata('Bearer token', 'NonExistent_Type')

      expect(result).toEqual({ documentTypeMetadata: null, error: null })
    })

    test('should return error when HTTP request fails', async () => {
      const networkError = new Error('Network error')
      mockHttpClient.mockRejectedValue(networkError)

      const result = await getDocumentTypeMetadata('Bearer token', 'CS_Agreement_Evidence')

      expect(result.documentTypeMetadata).toBeNull()
      expect(result.error).toBe(networkError)
    })

    test('should return error for invalid caseType exceeding max length', async () => {
      const longCaseType = 'a'.repeat(201)

      const result = await getDocumentTypeMetadata('Bearer token', longCaseType)

      expect(mockHttpClient).not.toHaveBeenCalled()
      expect(result.documentTypeMetadata).toBeNull()
      expect(result.error).toBeInstanceOf(Error)
      expect(result.error.message).toContain('Invalid caseType')
    })

    test('should return error for caseType with control characters', async () => {
      const result = await getDocumentTypeMetadata('Bearer token', 'bad\x00type')

      expect(mockHttpClient).not.toHaveBeenCalled()
      expect(result.documentTypeMetadata).toBeNull()
      expect(result.error).toBeInstanceOf(Error)
      expect(result.error.message).toContain('Invalid caseType')
    })

    test('should return error for empty caseType', async () => {
      const result = await getDocumentTypeMetadata('Bearer token', '')

      expect(mockHttpClient).not.toHaveBeenCalled()
      expect(result.documentTypeMetadata).toBeNull()
      expect(result.error).toBeInstanceOf(Error)
    })

    test('should return first result when multiple records returned', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          value: [
            {
              _rpa_scheme_value: 'first-scheme',
              _rpa_subject_value: 'first-subject',
              _rpa_teamrouting_value: 'first-team',
              rpa_documenttypesid: 'first-id'
            },
            {
              _rpa_scheme_value: 'second-scheme',
              _rpa_subject_value: 'second-subject',
              _rpa_teamrouting_value: 'second-team',
              rpa_documenttypesid: 'second-id'
            }
          ]
        })
      }
      mockHttpClient.mockResolvedValue(mockResponse)

      const result = await getDocumentTypeMetadata('Bearer token', 'CS_Agreement_Evidence')

      expect(result.documentTypeMetadata).toEqual({
        schemeValue: 'first-scheme',
        subjectValue: 'first-subject',
        teamRoutingValue: 'first-team',
        documentTypesId: 'first-id'
      })
    })
  })

  describe('getCaseIdByOnlineSubmissionId', () => {
    test('should return caseId from regardingobjectid lookup', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          value: [{ _regardingobjectid_value: 'case-found-123' }]
        })
      }
      mockHttpClient.mockResolvedValue(mockResponse)

      const { getCaseIdByOnlineSubmissionId } = await import('../../../src/repos/crm.js')
      const result = await getCaseIdByOnlineSubmissionId('Bearer token', 'ols-abc123')

      expect(mockHttpClient).toHaveBeenCalledWith(
        "https://crm.example.com/api/rpa_onlinesubmissions?%24select=_regardingobjectid_value&%24filter=rpa_onlinesubmissionid%20eq%20'ols-abc123'",
        {
          method: 'GET',
          headers: { Authorization: 'Bearer token', Prefer: 'return=representation', 'Content-Type': 'application/json' }
        }
      )
      expect(result).toEqual({ caseId: 'case-found-123', error: null })
    })

    test('should return null caseId when no results found', async () => {
      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({ value: [] }) }
      mockHttpClient.mockResolvedValue(mockResponse)

      const { getCaseIdByOnlineSubmissionId } = await import('../../../src/repos/crm.js')
      const result = await getCaseIdByOnlineSubmissionId('Bearer token', 'ols-notfound')

      expect(result).toEqual({ caseId: null, error: null })
    })

    test('should return error when fetch fails', async () => {
      mockHttpClient.mockRejectedValue(new Error('Network error'))

      const { getCaseIdByOnlineSubmissionId } = await import('../../../src/repos/crm.js')
      const result = await getCaseIdByOnlineSubmissionId('Bearer token', 'ols-abc123')

      expect(result.caseId).toBeNull()
      expect(result.error).toBeInstanceOf(Error)
      expect(result.error.message).toBe('Network error')
    })
  })
})
