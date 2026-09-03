import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

// This suite deliberately does NOT mock httpClient, for the same reason as
// crm-metadata-upsert-seam.test.js: the case-duplication fix rests on the
// same single comparison — that a 412 thrown by the HTTP client is
// recognisable as `err instanceof HttpError && err.cause.status === 412` —
// now applied to the whole case-creation changeset rather than to one
// metadata record. Every other test in crm.test.js asserts one side of that
// seam against a hand-built error; here the real client, the real retry
// machinery and the real repository run together against a stubbed fetch,
// reproducing the exact production sequence this fix exists for: the
// case-creation changeset is abandoned on a client timeout, Dataverse
// commits it anyway, and the redelivery meets its own prior write as a 412.

const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

vi.mock('../../../src/logging/logger.js', () => ({
  createLogger: () => mockLogger
}))

vi.mock('../../../src/config/index.js', () => ({
  config: {
    get: vi.fn((key) => {
      const values = {
        'crm.baseUrl': 'https://crm.example.com/api',
        'crm.caseOriginCode': 3,
        'retry.http.timeoutMs': 5000,
        'retry.http.authTimeoutMs': 2000,
        'retry.http.triageTimeoutMs': 1000,
        'retry.http.maxAttempts': 3,
        'retry.http.triageMaxAttempts': 1,
        'retry.http.unknownMaxAttempts': 2,
        'retry.http.baseDelayMs': 0,
        'retry.http.backoffMultiplier': 1,
        'retry.http.jitterPercentage': 0,
        'retry.http.maxDelayMs': 0,
        'retry.http.unknownMaxDelayMs': 0,
        'retry.http.retryAfterMaxDelayMs': 0
      }
      return key in values ? values[key] : null
    })
  }
}))

const { createCaseWithOnlineSubmission, deriveCaseRecordId, deriveMetadataRecordId } =
  await import('../../../src/repos/crm.js')

const CORRELATION_ID = '11111111-2222-4333-8444-555555555555'
const FILE_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa'
const TAKEOVER_FILE_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff'

const request = (overrides = {}) => ({
  authToken: '******',
  correlationId: CORRELATION_ID,
  fileId: FILE_ID,
  case: {
    title: 'Document Upload',
    caseDescription: 'File uploaded: file.pdf',
    contactId: 'contact-1',
    accountId: 'account-1',
    documentTypeMetadata: {
      schemeValue: 'scheme-1',
      subjectValue: 'subject-1',
      teamRoutingValue: 'team-1',
      documentTypesId: '4e88916b-aae2-ee11-904c-000d3adc1ec9'
    }
  },
  onlineSubmissionActivity: {
    subject: 'Document Upload - file.pdf',
    description: 'File uploaded: file.pdf',
    scheduledStart: '2026-01-01T10:00:00Z',
    scheduledEnd: '2026-01-01T11:00:00Z',
    stateCode: 0,
    statusCode: 1,
    metadata: { name: 'file.pdf', blobFileId: 'blob-1', mimeType: 'application/pdf' }
  },
  ...overrides
})

const successfulChangesetResponse = () => [
  '--batchresponse_deadbeef',
  'Content-Type: multipart/mixed; boundary=changesetresponse_deadbeef',
  '',
  '--changesetresponse_deadbeef', 'Content-Type: application/http', 'Content-Transfer-Encoding: binary', 'Content-ID: 1', '', 'HTTP/1.1 204 No Content', '', '',
  '--changesetresponse_deadbeef', 'Content-Type: application/http', 'Content-Transfer-Encoding: binary', 'Content-ID: 2', '', 'HTTP/1.1 204 No Content', '', '',
  '--changesetresponse_deadbeef', 'Content-Type: application/http', 'Content-Transfer-Encoding: binary', 'Content-ID: 3', '', 'HTTP/1.1 204 No Content', '', '',
  '--changesetresponse_deadbeef--',
  '--batchresponse_deadbeef--'
].join('\r\n')

describe('createCaseWithOnlineSubmission — real HTTP client seam', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('resolves a transient 500 on the changeset followed by a 412 as a single suppressed success', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (input) => {
      calls++
      const url = typeof input === 'string' ? input : input.url
      if (calls === 1) {
        return new Response('server error', { status: 500 })
      }
      if (url.endsWith('/$batch')) {
        return new Response('', { status: 412 })
      }
      // The suppression fallback's own metadata write, addressed on its own
      // entity set, is a distinct URL from /$batch.
      return new Response(null, { status: 204 })
    }))

    const result = await createCaseWithOnlineSubmission(request())

    expect(calls).toBe(3)
    expect(result).toEqual({
      caseId: deriveCaseRecordId(CORRELATION_ID),
      // The identifier generated for this suppressed attempt was never
      // persisted — an earlier attempt's changeset already committed a
      // different value — so it must not be reported as if it were real.
      rpaOnlinesubmissionid: null,
      error: null
    })
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({ type: 'crm.case.create_suppressed', reference: deriveCaseRecordId(CORRELATION_ID) })
      }),
      'Case already exists, duplicate creation suppressed'
    )
  })

  test('resolves an immediate 412 on the changeset as a suppressed success without retrying the changeset itself', async () => {
    let batchCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : input.url
      if (url.endsWith('/$batch')) {
        batchCalls++
        return new Response('', { status: 412 })
      }
      return new Response(null, { status: 204 })
    }))

    const result = await createCaseWithOnlineSubmission(request())

    expect(batchCalls).toBe(1)
    expect(result.error).toBeNull()
    expect(result.caseId).toBe(deriveCaseRecordId(CORRELATION_ID))
  })

  test('a takeover — a different fileId meeting a 412 — still writes its own new metadata record', async () => {
    let metadataUrl = null
    vi.stubGlobal('fetch', vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : input.url
      if (url.endsWith('/$batch')) {
        return new Response('', { status: 412 })
      }
      metadataUrl = url
      return new Response(null, { status: 204 })
    }))

    const result = await createCaseWithOnlineSubmission(request({ fileId: TAKEOVER_FILE_ID }))

    expect(result.error).toBeNull()
    expect(result.caseId).toBe(deriveCaseRecordId(CORRELATION_ID))
    expect(metadataUrl).toBe(
      `https://crm.example.com/api/rpa_activitymetadatas(${deriveMetadataRecordId(CORRELATION_ID, TAKEOVER_FILE_ID)})`
    )
  })

  test('reports a genuine 409 on the changeset as an error rather than suppressing it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('{"error":{"message":"conflict"}}', { status: 409 })
    ))

    const result = await createCaseWithOnlineSubmission(request())

    expect(result.caseId).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
    expect(mockLogger.info).not.toHaveBeenCalledWith(
      expect.anything(),
      'Case already exists, duplicate creation suppressed'
    )
  })

  test('issues a single POST to $batch with three CRLF-framed conditional PATCH parts on the create path', async () => {
    const fetchSpy = vi.fn(async () => new Response(successfulChangesetResponse(), { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)

    const result = await createCaseWithOnlineSubmission(request())

    expect(result.error).toBeNull()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const sentRequest = fetchSpy.mock.calls[0][0]
    expect(sentRequest.method).toBe('POST')
    expect(sentRequest.url).toBe('https://crm.example.com/api/$batch')
    expect(sentRequest.headers.get('content-type')).toMatch(/^multipart\/mixed;boundary=batch_/)
  })
})
