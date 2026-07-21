import { describe, test, expect, vi, beforeEach } from 'vitest'

const mockHttpClient = vi.fn()

vi.mock('../../../src/http/client.js', () => ({
  httpClient: mockHttpClient
}))

// Mock config
vi.mock('../../../src/config/index.js', () => ({
  config: {
    get: vi.fn((key) => {
      if (key === 'crm.baseUrl') return 'https://crm.example.com/api'
      return null
    })
  }
}))

// Import after mocks
const { getContactIdFromCrn, getAccountIdFromSbi, createCaseWithOnlineSubmission, getDocumentTypeMetadata } = await import('../../../src/repos/crm.js')

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
        caseorigincode: 100000002,
        prioritycode: 2,
        'customerid_contact@odata.bind': '/contacts(contact-123)',
        'rpa_Contact@odata.bind': '/contacts(contact-123)',
        'rpa_Organisation@odata.bind': '/accounts(account-456)',
        _rpa_scheme_value: 'scheme-abc',
        _rpa_subject_value: 'subject-def',
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
        statuscode: 1
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

  describe('getOnlineSubmissionId', () => {
    test('should fetch online submission id for case', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ incident_rpa_onlinesubmissions: [{ rpa_onlinesubmissionid: 'OLS-2026-0001' }] })
      }
      mockHttpClient.mockResolvedValue(mockResponse)

      const { getOnlineSubmissionId } = await import('../../../src/repos/crm.js')

      const result = await getOnlineSubmissionId('Bearer token', 'case-123')

      expect(mockHttpClient).toHaveBeenCalledWith(
        'https://crm.example.com/api/incidents(case-123)?%24select=incidentid,title&%24expand=incident_rpa_onlinesubmissions(%24select=rpa_onlinesubmissionid)',
        {
          method: 'GET',
          headers: { Authorization: 'Bearer token', Prefer: 'return=representation', 'Content-Type': 'application/json' }
        }
      )

      expect(result).toEqual({ rpaOnlinesubmissionid: 'OLS-2026-0001', error: null })
    })

    test('should return error when fetch fails', async () => {
      mockHttpClient.mockRejectedValue(new Error('Network error'))
      const { getOnlineSubmissionId } = await import('../../../src/repos/crm.js')
      const result = await getOnlineSubmissionId('Bearer token', 'case-123')
      expect(result.rpaOnlinesubmissionid).toBeNull()
      expect(result.error).toBeInstanceOf(Error)
      expect(result.error.message).toBe('Network error')
    })

    test('should handle empty online submissions array', async () => {
      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({ incident_rpa_onlinesubmissions: [] }) }
      mockHttpClient.mockResolvedValue(mockResponse)
      const { getOnlineSubmissionId } = await import('../../../src/repos/crm.js')
      const result = await getOnlineSubmissionId('Bearer token', 'case-123')
      expect(result).toEqual({ rpaOnlinesubmissionid: null, error: null })
    })
  })

  describe('createMetadataForOnlineSubmission', () => {
    test('should post metadata to online submission and return metadataId', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ rpa_activitymetadataid: 'meta-123' })
      }
      mockHttpClient.mockResolvedValue(mockResponse)

      const { createMetadataForOnlineSubmission } = await import('../../../src/repos/crm.js')

      const result = await createMetadataForOnlineSubmission({
        authToken: 'Bearer token',
        rpaOnlinesubmissionid: 'OLS-2026-0001',
        metadata: { name: 'file.pdf', blobFileId: 'blob-1', mimeType: 'application/pdf' }
      })

      expect(result).toEqual({ metadataId: 'meta-123', error: null })
      const lastCall = mockHttpClient.mock.calls[0]
      const body = JSON.parse(lastCall[1].body)
      expect(body.rpa_filemimetype).toBe('application/pdf')
    })

    test('should omit rpa_filemimetype when mimeType not provided in createMetadataForOnlineSubmission', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ rpa_activitymetadataid: 'meta-124' })
      }
      mockHttpClient.mockResolvedValue(mockResponse)
      const { createMetadataForOnlineSubmission } = await import('../../../src/repos/crm.js')

      const result = await createMetadataForOnlineSubmission({
        authToken: 'Bearer token',
        rpaOnlinesubmissionid: 'OLS-2026-0002',
        metadata: { name: 'file.pdf', blobFileId: 'blob-1' }
      })

      expect(result).toEqual({ metadataId: 'meta-124', error: null })
      const lastCall = mockHttpClient.mock.calls[0]
      const body = JSON.parse(lastCall[1].body)
      expect(body.rpa_filemimetype).toBeUndefined()
    })

    test('should return error when fetch fails', async () => {
      mockHttpClient.mockRejectedValue(new Error('Network error'))
      const { createMetadataForOnlineSubmission } = await import('../../../src/repos/crm.js')
      const result = await createMetadataForOnlineSubmission({ authToken: 'Bearer token', rpaOnlinesubmissionid: 'ols', metadata: {} })
      expect(result.metadataId).toBeNull()
      expect(result.error).toBeInstanceOf(Error)
      expect(result.error.message).toBe('Network error')
    })

    test('should handle response without metadata id', async () => {
      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({}) }
      mockHttpClient.mockResolvedValue(mockResponse)
      const { createMetadataForOnlineSubmission } = await import('../../../src/repos/crm.js')
      const result = await createMetadataForOnlineSubmission({ authToken: 'Bearer token', rpaOnlinesubmissionid: 'ols', metadata: { name: 'a' } })
      expect(result).toEqual({ metadataId: null, error: null })
    })

    test('should include provided documentTypeId in payload', async () => {
      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({ rpa_activitymetadataid: 'meta-456' }) }
      mockHttpClient.mockResolvedValue(mockResponse)
      const { createMetadataForOnlineSubmission } = await import('../../../src/repos/crm.js')

      const result = await createMetadataForOnlineSubmission({
        authToken: 'Bearer token',
        rpaOnlinesubmissionid: 'OLS-2026-0001',
        metadata: { name: 'file.pdf', blobFileId: 'blob-1', documentTypeId: 'abcd-1234' }
      })

      expect(result).toEqual({ metadataId: 'meta-456', error: null })
      const lastCall = mockHttpClient.mock.calls[0]
      const body = JSON.parse(lastCall[1].body)
      expect(body['rpa_DocumentTypeMetaId@odata.bind']).toBe('/rpa_documenttypeses(abcd-1234)')
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
            rpa_documenttypesid: 'fe2785b9-f06e-f111-ab0c-7c1e5235c19d'
          }]
        })
      }
      mockHttpClient.mockResolvedValue(mockResponse)

      const result = await getDocumentTypeMetadata('Bearer token', 'CS_Agreement_Evidence')

      expect(mockHttpClient).toHaveBeenCalledWith(
        "https://crm.example.com/api/rpa_documenttypeses?%24select=_rpa_scheme_value,_rpa_subject_value,rpa_documenttypesid&%24filter=rpa_documenttype%20eq%20'CS_Agreement_Evidence'",
        {
          method: 'GET',
          headers: { Authorization: 'Bearer token', Prefer: 'return=representation', 'Content-Type': 'application/json' }
        }
      )
      expect(result).toEqual({
        documentTypeMetadata: {
          schemeValue: 'd7655ccd-4c2d-ef11-840a-000d3ab4c5e3',
          subjectValue: '4e1910c7-b0d7-ee11-904d-0022489fd23c',
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
              rpa_documenttypesid: 'first-id'
            },
            {
              _rpa_scheme_value: 'second-scheme',
              _rpa_subject_value: 'second-subject',
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
        documentTypesId: 'first-id'
      })
    })
  })

  describe('createMetadataForExistingCase', () => {
    test('should post metadata for existing case and return metadataId with contact/account binds', async () => {
      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({ rpa_activitymetadataid: 'meta-existing-123' }) }
      mockHttpClient.mockResolvedValue(mockResponse)

      const { createMetadataForExistingCase } = await import('../../../src/repos/crm.js')

      const result = await createMetadataForExistingCase({
        authToken: 'Bearer token',
        caseId: 'case-789',
        metadata: { name: 'file.pdf', blobFileId: 'blob-1', contactId: 'contact-1', accountId: 'account-1', mimeType: 'application/pdf' }
      })

      expect(result).toEqual({ metadataId: 'meta-existing-123', error: null })
      const lastCall = mockHttpClient.mock.calls[0]
      expect(lastCall[0]).toBe('https://crm.example.com/api/incidents(case-789)/incident_rpa_activitymetadata')
      const body = JSON.parse(lastCall[1].body)
      expect(body.rpa_name).toBe('file.pdf')
      expect(body.rpa_filemimetype).toBe('application/pdf')
      expect(body['rpa_Contact@odata.bind']).toBe('/contacts(contact-1)')
      expect(body['rpa_Organisation@odata.bind']).toBe('/accounts(account-1)')
    })

    test('should omit rpa_filemimetype when mimeType not provided in createMetadataForExistingCase', async () => {
      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({ rpa_activitymetadataid: 'meta-existing-124' }) }
      mockHttpClient.mockResolvedValue(mockResponse)

      const { createMetadataForExistingCase } = await import('../../../src/repos/crm.js')

      const result = await createMetadataForExistingCase({
        authToken: 'Bearer token',
        caseId: 'case-790',
        metadata: { name: 'file.pdf', blobFileId: 'blob-1', contactId: 'contact-1', accountId: 'account-1' }
      })

      expect(result).toEqual({ metadataId: 'meta-existing-124', error: null })
      const lastCall = mockHttpClient.mock.calls[0]
      const body = JSON.parse(lastCall[1].body)
      expect(body.rpa_filemimetype).toBeUndefined()
    })

    test('should return error when fetch fails', async () => {
      mockHttpClient.mockRejectedValue(new Error('Network error'))
      const { createMetadataForExistingCase } = await import('../../../src/repos/crm.js')
      const result = await createMetadataForExistingCase({ authToken: 'Bearer token', caseId: 'case-1', metadata: { name: 'a' } })
      expect(result.metadataId).toBeNull()
      expect(result.error).toBeInstanceOf(Error)
      expect(result.error.message).toBe('Network error')
    })

    test('should handle response without metadata id', async () => {
      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({}) }
      mockHttpClient.mockResolvedValue(mockResponse)
      const { createMetadataForExistingCase } = await import('../../../src/repos/crm.js')
      const result = await createMetadataForExistingCase({ authToken: 'Bearer token', caseId: 'case-2', metadata: { name: 'a' } })
      expect(result).toEqual({ metadataId: null, error: null })
    })

    test('should include provided documentTypeId in payload', async () => {
      const mockResponse = { ok: true, json: vi.fn().mockResolvedValue({ rpa_activitymetadataid: 'meta-999' }) }
      mockHttpClient.mockResolvedValue(mockResponse)
      const { createMetadataForExistingCase } = await import('../../../src/repos/crm.js')

      const result = await createMetadataForExistingCase({
        authToken: 'Bearer token',
        caseId: 'case-3',
        metadata: { name: 'file.pdf', blobFileId: 'blob-1', documentTypeId: 'doc-999' }
      })

      expect(result).toEqual({ metadataId: 'meta-999', error: null })
      const lastCall = mockHttpClient.mock.calls[0]
      const body = JSON.parse(lastCall[1].body)
      expect(body['rpa_DocumentTypeMetaId@odata.bind']).toBe('/rpa_documenttypeses(doc-999)')
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
