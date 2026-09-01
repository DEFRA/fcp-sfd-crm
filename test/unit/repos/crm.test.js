import { describe, test, expect, vi, beforeEach } from 'vitest'
import { HttpError } from '@fetchkit/ffetch'

const mockHttpClient = vi.fn()
const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
const mockConfigGet = vi.fn((key) => {
  if (key === 'crm.baseUrl') return 'https://crm.example.com/api'
  if (key === 'crm.caseOriginCode') return 3
  return null
})

vi.mock('../../../src/http/client.js', () => ({
  httpClient: mockHttpClient
}))

vi.mock('../../../src/logging/logger.js', () => ({
  createLogger: () => mockLogger
}))

// Mock config
vi.mock('../../../src/config/index.js', () => ({
  config: {
    get: mockConfigGet
  }
}))

// Import after mocks
const { getContactIdFromCrn, getAccountIdFromSbi, createCaseWithOnlineSubmission, getDocumentTypeMetadata, deriveMetadataRecordId, deriveCaseRecordId, deriveOnlineSubmissionRecordId } = await import('../../../src/repos/crm.js')

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
    const CASE_CORRELATION_ID = '77777777-8888-4999-8aaa-bbbbbbbbbbbb'
    const CASE_FILE_ID = 'cccccccc-dddd-4eee-8fff-000000000000'

    // vi.clearAllMocks() in the outer beforeEach clears call history but not a
    // still-queued mockResolvedValueOnce/mockRejectedValueOnce chain from a
    // previous test, which silently leaks a queued response into this suite's
    // multi-call (412-then-fallback) tests. Reset fully, scoped to this block.
    beforeEach(() => {
      mockHttpClient.mockReset()
    })

    const buildRequest = (overrides = {}) => ({
      authToken: 'Bearer token',
      correlationId: CASE_CORRELATION_ID,
      fileId: CASE_FILE_ID,
      case: {
        title: 'Test case title',
        caseDescription: 'Test case description',
        contactId: 'contact-123',
        accountId: 'account-456',
        documentTypeMetadata: {
          schemeValue: 'scheme-abc',
          subjectValue: 'subject-def',
          teamRoutingValue: 'team-ghi',
          documentTypesId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
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
      },
      ...overrides
    })

    // Mirrors the shape a real Dataverse $batch response uses for three
    // successful (204) conditional upserts. Hand-built rather than produced
    // via buildChangesetRequest/parseBatchResponse, so this test does not
    // merely check the implementation against itself.
    const successfulBatchResponseText = () => [
      '--batchresponse_deadbeef',
      'Content-Type: multipart/mixed; boundary=changesetresponse_deadbeef',
      '',
      '--changesetresponse_deadbeef',
      'Content-Type: application/http',
      'Content-Transfer-Encoding: binary',
      'Content-ID: 1',
      '',
      'HTTP/1.1 204 No Content',
      'OData-Version: 4.0',
      '',
      '',
      '--changesetresponse_deadbeef',
      'Content-Type: application/http',
      'Content-Transfer-Encoding: binary',
      'Content-ID: 2',
      '',
      'HTTP/1.1 204 No Content',
      'OData-Version: 4.0',
      '',
      '',
      '--changesetresponse_deadbeef',
      'Content-Type: application/http',
      'Content-Transfer-Encoding: binary',
      'Content-ID: 3',
      '',
      'HTTP/1.1 204 No Content',
      'OData-Version: 4.0',
      '',
      '',
      '--changesetresponse_deadbeef--',
      '--batchresponse_deadbeef--'
    ].join('\r\n')

    const suppressedHttpError = () => new HttpError('HTTP error: 412 Precondition Failed', {
      status: 412,
      text: vi.fn().mockResolvedValue('')
    })

    test('should issue one POST to $batch, never a POST to a record collection, and return the derived caseId', async () => {
      mockHttpClient.mockResolvedValue({ text: vi.fn().mockResolvedValue(successfulBatchResponseText()) })

      const { caseId, rpaOnlinesubmissionid, error } = await createCaseWithOnlineSubmission(buildRequest())

      expect(mockHttpClient).toHaveBeenCalledTimes(1)
      const [url, options] = mockHttpClient.mock.calls[0]
      expect(url).toBe('https://crm.example.com/api/$batch')
      expect(options.method).toBe('POST')
      expect(options.headers.Authorization).toBe('Bearer token')
      expect(options.headers['Content-Type']).toMatch(/^multipart\/mixed;boundary=batch_/)

      expect(caseId).toBe(deriveCaseRecordId(CASE_CORRELATION_ID))
      expect(rpaOnlinesubmissionid).toHaveLength(20)
      expect(error).toBeNull()
    })

    test('should carry exactly three CRLF-framed PATCH parts, each conditional and none carrying Prefer', async () => {
      mockHttpClient.mockResolvedValue({ text: vi.fn().mockResolvedValue(successfulBatchResponseText()) })

      await createCaseWithOnlineSubmission(buildRequest())

      const body = mockHttpClient.mock.calls[0][1].body
      expect(body.split('\n').every((line, i, arr) => i === arr.length - 1 || line.endsWith('\r'))).toBe(true)

      const patchCount = (body.match(/^PATCH /gm) ?? []).length
      expect(patchCount).toBe(3)
      const ifNoneMatchCount = (body.match(/If-None-Match: \*/g) ?? []).length
      expect(ifNoneMatchCount).toBe(3)
      expect(body).not.toContain('Prefer:')

      const caseId = deriveCaseRecordId(CASE_CORRELATION_ID)
      const onlineSubmissionId = deriveOnlineSubmissionRecordId(CASE_CORRELATION_ID)
      const metadataId = deriveMetadataRecordId(CASE_CORRELATION_ID, CASE_FILE_ID)
      expect(body).toContain(`PATCH https://crm.example.com/api/incidents(${caseId}) HTTP/1.1`)
      expect(body).toContain(`PATCH https://crm.example.com/api/rpa_onlinesubmissions(${onlineSubmissionId}) HTTP/1.1`)
      expect(body).toContain(`PATCH https://crm.example.com/api/rpa_activitymetadatas(${metadataId}) HTTP/1.1`)
    })

    test('should bind the online submission to the case via the verified regardingobjectid navigation property', async () => {
      mockHttpClient.mockResolvedValue({ text: vi.fn().mockResolvedValue(successfulBatchResponseText()) })

      await createCaseWithOnlineSubmission(buildRequest())

      const body = mockHttpClient.mock.calls[0][1].body
      const caseId = deriveCaseRecordId(CASE_CORRELATION_ID)
      expect(body).toContain(`"regardingobjectid_incident_rpa_onlinesubmission@odata.bind":"/incidents(${caseId})"`)
    })

    test('should include rpa_filesinsubmission when a valid positive value is present', async () => {
      mockHttpClient.mockResolvedValue({ text: vi.fn().mockResolvedValue(successfulBatchResponseText()) })

      await createCaseWithOnlineSubmission(buildRequest({ filesInSubmission: 3 }))

      const body = mockHttpClient.mock.calls[0][1].body
      expect(body).toContain('"rpa_filesinsubmission":3')
    })

    test('should omit rpa_filesinsubmission when the value is missing or invalid', async () => {
      mockHttpClient.mockResolvedValue({ text: vi.fn().mockResolvedValue(successfulBatchResponseText()) })

      await createCaseWithOnlineSubmission(buildRequest({ filesInSubmission: 0 }))
      const body = mockHttpClient.mock.calls[0][1].body
      expect(body).not.toContain('rpa_filesinsubmission')
    })

    test('should never send a nested navigation property, the mistake 0x80060888 punishes', async () => {
      mockHttpClient.mockResolvedValue({ text: vi.fn().mockResolvedValue(successfulBatchResponseText()) })

      await createCaseWithOnlineSubmission(buildRequest())

      const body = mockHttpClient.mock.calls[0][1].body
      expect(body).not.toContain('incident_rpa_onlinesubmissions')
      expect(body).not.toContain('rpa_onlinesubmission_rpa_activitymetadata')
    })

    // The case and the activity are owned independently: Dataverse assigns a
    // new activity to the calling user, so routing the case alone leaves the
    // activity owned by the integration's service principal.
    test('should bind ownerid@odata.bind to the routing team on both the case and the online submission', async () => {
      mockHttpClient.mockResolvedValue({ text: vi.fn().mockResolvedValue(successfulBatchResponseText()) })

      await createCaseWithOnlineSubmission(buildRequest())

      const body = mockHttpClient.mock.calls[0][1].body
      const ownerBindCount = (body.match(/"ownerid@odata\.bind":"\/teams\(team-ghi\)"/g) ?? []).length
      expect(ownerBindCount).toBe(2)
    })

    // Every documentTypeMetadata field is bound into the changeset and so is
    // required in the same way. Asserted for each rather than singling out
    // team routing, which would imply the others were optional.
    test.each(['schemeValue', 'subjectValue', 'teamRoutingValue', 'documentTypesId'])(
      'should write nothing at all when documentTypeMetadata is missing %s',
      async (field) => {
        const request = buildRequest()
        delete request.case.documentTypeMetadata[field]

        const { caseId, error } = await createCaseWithOnlineSubmission(request)

        expect(caseId).toBeNull()
        expect(error).toBeInstanceOf(Error)
        expect(error.message).toBe(`Incomplete documentTypeMetadata: ${field} required`)
        expect(mockHttpClient).not.toHaveBeenCalled()
      }
    )

    test('should omit rpa_filemimetype when no mime type is provided', async () => {
      mockHttpClient.mockResolvedValue({ text: vi.fn().mockResolvedValue(successfulBatchResponseText()) })

      const request = buildRequest()
      delete request.onlineSubmissionActivity.metadata.mimeType

      await createCaseWithOnlineSubmission(request)

      const body = mockHttpClient.mock.calls[0][1].body
      expect(body).not.toContain('rpa_filemimetype')
    })

    test('should treat a 412 on the changeset as success, log the suppression, and write only the current file\'s metadata', async () => {
      mockHttpClient
        .mockRejectedValueOnce(suppressedHttpError())
        .mockResolvedValueOnce({ ok: true, status: 204 })

      const { caseId, rpaOnlinesubmissionid, error } = await createCaseWithOnlineSubmission(buildRequest())

      expect(caseId).toBe(deriveCaseRecordId(CASE_CORRELATION_ID))
      // Never persisted for this attempt (an earlier attempt's changeset
      // already committed a different value), so it must not be reported.
      expect(rpaOnlinesubmissionid).toBeNull()
      expect(error).toBeNull()

      expect(mockHttpClient).toHaveBeenCalledTimes(2)
      const [metadataUrl, metadataOptions] = mockHttpClient.mock.calls[1]
      const metadataId = deriveMetadataRecordId(CASE_CORRELATION_ID, CASE_FILE_ID)
      expect(metadataUrl).toBe(`https://crm.example.com/api/rpa_activitymetadatas(${metadataId})`)
      expect(metadataOptions.method).toBe('PATCH')
      expect(metadataOptions.headers['If-None-Match']).toBe('*')

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: expect.objectContaining({
            type: 'crm.case.create_suppressed',
            outcome: 'success',
            reference: deriveCaseRecordId(CASE_CORRELATION_ID)
          })
        }),
        'Case already exists, duplicate creation suppressed'
      )
    })

    test('should still write a genuinely new metadata record on takeover — a different fileId after a 412', async () => {
      const takeoverFileId = 'ffffffff-1111-4222-8333-444444444444'
      mockHttpClient
        .mockRejectedValueOnce(suppressedHttpError())
        .mockResolvedValueOnce({ ok: true, status: 204 })

      const { caseId, error } = await createCaseWithOnlineSubmission(buildRequest({ fileId: takeoverFileId }))

      expect(error).toBeNull()
      expect(caseId).toBe(deriveCaseRecordId(CASE_CORRELATION_ID))
      const [metadataUrl] = mockHttpClient.mock.calls[1]
      expect(metadataUrl).toBe(`https://crm.example.com/api/rpa_activitymetadatas(${deriveMetadataRecordId(CASE_CORRELATION_ID, takeoverFileId)})`)
    })

    test('should still fail as an error for a non-412 4xx or 5xx response on the changeset', async () => {
      const httpError = new HttpError('HTTP error: 500 Internal Server Error', {
        status: 500,
        text: vi.fn().mockResolvedValue('{"error":{"message":"server error"}}')
      })
      mockHttpClient.mockRejectedValue(httpError)

      const { caseId, error } = await createCaseWithOnlineSubmission(buildRequest())

      expect(caseId).toBeNull()
      expect(error).toBe(httpError)
      expect(error.crmError).toBe('{"error":{"message":"server error"}}')
    })

    test('should attach the derived case id to the error even on failure, so callers can log which case a failure relates to', async () => {
      const httpError = new HttpError('HTTP error: 500 Internal Server Error', {
        status: 500,
        text: vi.fn().mockResolvedValue('')
      })
      mockHttpClient.mockRejectedValue(httpError)

      const { error } = await createCaseWithOnlineSubmission(buildRequest())

      expect(error.derivedCaseId).toBe(deriveCaseRecordId(CASE_CORRELATION_ID))
    })

    test('should not attach a derived case id when correlationId itself was missing', async () => {
      const { error } = await createCaseWithOnlineSubmission(buildRequest({ correlationId: undefined }))

      expect(error.derivedCaseId).toBeUndefined()
    })

    test('should treat a 200 batch response with no parts as a failure, not a silent success', async () => {
      mockHttpClient.mockResolvedValue({ text: vi.fn().mockResolvedValue('--batchresponse_empty\r\n--batchresponse_empty--\r\n') })

      const { caseId, error } = await createCaseWithOnlineSubmission(buildRequest())

      expect(caseId).toBeNull()
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toMatch(/Malformed \$batch response/)
    })

    test('should treat a batch response with fewer parts than sent as a failure', async () => {
      const twoOfThreeParts = [
        '--batchresponse_deadbeef',
        'Content-Type: multipart/mixed; boundary=changesetresponse_deadbeef',
        '',
        '--changesetresponse_deadbeef',
        'Content-Type: application/http',
        'Content-Transfer-Encoding: binary',
        'Content-ID: 1',
        '',
        'HTTP/1.1 204 No Content',
        '',
        '',
        '--changesetresponse_deadbeef--',
        '--batchresponse_deadbeef--'
      ].join('\r\n')
      mockHttpClient.mockResolvedValue({ text: vi.fn().mockResolvedValue(twoOfThreeParts) })

      const { caseId, error } = await createCaseWithOnlineSubmission(buildRequest())

      expect(caseId).toBeNull()
      expect(error.message).toMatch(/Malformed \$batch response/)
    })

    test.each([
      ['correlationId', { correlationId: undefined }],
      ['fileId', { fileId: undefined }],
      ['both identifiers', { correlationId: undefined, fileId: undefined }]
    ])('should refuse to derive record keys when %s is missing, without calling the CRM API', async (_label, overrides) => {
      const { caseId, error } = await createCaseWithOnlineSubmission(buildRequest(overrides))

      expect(caseId).toBeNull()
      expect(error).toBeInstanceOf(Error)
      expect(error.message).toContain('Cannot derive stable record keys')
      expect(mockHttpClient).not.toHaveBeenCalled()
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

    // Pinned regression: this literal value must never change. Records already
    // exist in both Dataverse organisations under this exact derivation, and a
    // silent change to deriveMetadataRecordId's input shape would orphan them.
    test('should derive a specific literal id for a specific literal input pair (pinned regression)', () => {
      expect(deriveMetadataRecordId(CORRELATION_ID, FILE_ID)).toBe('a835c318-0b29-4127-890b-39c48fd74cd1')
    })
  })

  describe('deriveCaseRecordId and deriveOnlineSubmissionRecordId', () => {
    test('should derive a stable id across repeated calls for the same correlationId', () => {
      expect(deriveCaseRecordId(CORRELATION_ID)).toBe(deriveCaseRecordId(CORRELATION_ID))
      expect(deriveOnlineSubmissionRecordId(CORRELATION_ID)).toBe(deriveOnlineSubmissionRecordId(CORRELATION_ID))
    })

    test('should derive a different id for a different correlationId', () => {
      expect(deriveCaseRecordId(CORRELATION_ID)).not.toBe(deriveCaseRecordId('correlation-xyz'))
      expect(deriveOnlineSubmissionRecordId(CORRELATION_ID)).not.toBe(deriveOnlineSubmissionRecordId('correlation-xyz'))
    })

    test('should match the GUID shape required by guidSchema', () => {
      const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      expect(deriveCaseRecordId(CORRELATION_ID)).toMatch(guidPattern)
      expect(deriveOnlineSubmissionRecordId(CORRELATION_ID)).toMatch(guidPattern)
    })

    test('should derive different ids for the case and the online submission from the same correlationId', () => {
      expect(deriveCaseRecordId(CORRELATION_ID)).not.toBe(deriveOnlineSubmissionRecordId(CORRELATION_ID))
    })

    test('should derive different ids from the case/online-submission namespaces than the metadata derivation for related inputs', () => {
      expect(deriveCaseRecordId(CORRELATION_ID)).not.toBe(deriveMetadataRecordId(CORRELATION_ID, FILE_ID))
      expect(deriveOnlineSubmissionRecordId(CORRELATION_ID)).not.toBe(deriveMetadataRecordId(CORRELATION_ID, FILE_ID))
    })

    test('should derive specific literal ids for a specific literal correlationId (pinned regression)', () => {
      expect(deriveCaseRecordId(CORRELATION_ID)).toBe('a3af1549-2c7e-48cb-bac2-1242ba7f8c14')
      expect(deriveOnlineSubmissionRecordId(CORRELATION_ID)).toBe('8ff76226-d8ef-4416-92f8-dd4eaf04c928')
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
        {
          event: { reference: expectedId },
          tenant: { message: `fileId=${FILE_ID}` }
        },
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
})
