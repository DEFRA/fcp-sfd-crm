import { describe, test, expect, vi, beforeEach } from 'vitest'

// Mock fetch globally
global.fetch = vi.fn()

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
const { getContactIdFromCrn, getAccountIdFromSbi, createCaseWithOnlineSubmission } = await import('../../../src/repos/crm.js')

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
      global.fetch.mockResolvedValue(mockResponse)

      const result = await getContactIdFromCrn('Bearer token', '1234567890')

      expect(global.fetch).toHaveBeenCalledWith(
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
      global.fetch.mockResolvedValue(mockResponse)

      const result = await getContactIdFromCrn('Bearer token', '1234567890')

      expect(result).toEqual({ contactId: '6ff3f89f-efe6-f455-fff6-bfff1f808e6' })
    })

    test('should handle fetch error for SBI and return error message', async () => {
      const mockError = new Error('Network error')
      global.fetch.mockRejectedValue(mockError)

      const result = await getContactIdFromCrn('Bearer token', '1234567890')

      expect(result).toEqual({
        contactId: null,
        error: 'Network error'
      })
    })

    test('should handle JSON parsing error for SBI and return error message', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockRejectedValue(new Error('Invalid JSON'))
      }
      global.fetch.mockResolvedValue(mockResponse)

      const result = await getContactIdFromCrn('Bearer token', '1234567890')

      expect(result).toEqual({
        contactId: null,
        error: 'Invalid JSON'
      })
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
      global.fetch.mockResolvedValue(mockResponse)

      const result = await getAccountIdFromSbi('Bearer token', '987654321')

      expect(global.fetch).toHaveBeenCalledWith(
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
      global.fetch.mockResolvedValue(mockResponse)

      const result = await getAccountIdFromSbi('Bearer token', '987654321')

      expect(result).toEqual({ accountId: '7dd1d67d-cdc4-f233-ddf4-9efe9e686c4' })
    })

    test('should handle fetch error for CRN and return error message', async () => {
      const mockError = new Error('Network error')
      global.fetch.mockRejectedValue(mockError)

      const result = await getAccountIdFromSbi('Bearer token', '987654321')

      expect(result).toEqual({
        accountId: null,
        error: 'Network error'
      })
    })

    test('should handle JSON parsing error for CRN and return error message', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockRejectedValue(new Error('Invalid JSON'))
      }
      global.fetch.mockResolvedValue(mockResponse)

      const result = await getAccountIdFromSbi('Bearer token', '987654321')

      expect(result).toEqual({
        accountId: null,
        error: 'Invalid JSON'
      })
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

      global.fetch.mockResolvedValue(mockResponse)

      const request = {
        authToken: 'Bearer token',
        case: {
          title: 'Test case title',
          caseDescription: 'Test case description',
          contactId: 'contact-123',
          accountId: 'account-456'
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
            fileUrl: 'https://files.example.com/original.pdf',
            copiedFileUrl: 'https://files.example.com/copied.pdf'
          }
        }
      }

      const { caseId, error } = await createCaseWithOnlineSubmission(request)

      expect(global.fetch).toHaveBeenCalledWith(
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

      const payload = JSON.parse(global.fetch.mock.calls[0][1].body)

      expect(payload).toMatchObject({
        title: 'Test case title',
        description: 'Test case description',
        caseorigincode: 100000002,
        prioritycode: 2,
        'customerid_contact@odata.bind': '/contacts(contact-123)',
        'rpa_Contact@odata.bind': '/contacts(contact-123)',
        'rpa_Organisation@odata.bind': '/accounts(account-456)',
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
        statecode: 0,
        statuscode: 1
      })

      expect(submission.rpa_onlinesubmission_rpa_activitymetadata[0]).toEqual({
        rpa_name: 'test-document.pdf',
        rpa_fileabsoluteurl: 'https://files.example.com/original.pdf',
        rpa_copiedfileurl: 'https://files.example.com/original.pdf',
        'rpa_DocumentTypeMetaId@odata.bind': '/rpa_documenttypeses(4e88916b-aae2-ee11-904c-000d3adc1ec9)'
      })

      expect(caseId).toBe('8bb8b45b-aba2-f011-bbd2-7ced8d4645a2')
      expect(error).toBeNull()
    })

    test('should return error when fetch throws', async () => {
      global.fetch.mockRejectedValue(new Error('Network error'))

      const { caseId, error } = await createCaseWithOnlineSubmission({
        authToken: 'Bearer token',
        case: {
          title: 'Test',
          caseDescription: 'Test',
          contactId: 'contact-123',
          accountId: 'account-456'
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
            fileUrl: 'url',
            copiedFileUrl: 'copied-url'
          }
        }
      })

      expect(caseId).toBeNull()
      expect(error).toBe('Network error')
    })

    test('should return error when response json parsing fails', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockRejectedValue(new Error('Invalid JSON'))
      })

      const { caseId, error } = await createCaseWithOnlineSubmission({
        authToken: 'Bearer token',
        case: {
          title: 'Test',
          caseDescription: 'Test',
          contactId: 'contact-123',
          accountId: 'account-456'
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
            fileUrl: 'url',
            copiedFileUrl: 'copied-url'
          }
        }
      })

      expect(caseId).toBeNull()
      expect(error).toBe('Invalid JSON')
    })
  })
})
