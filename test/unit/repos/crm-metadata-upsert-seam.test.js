import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

// This suite deliberately does NOT mock httpClient.
//
// The duplicate suppression fix rests on a single comparison in crm.js:
// that a 412 thrown by the HTTP client is recognisable as `err instanceof
// HttpError && err.cause.status === 412`. Every other test asserts one side of
// that seam against a hand-built error, so a change in how @fetchkit/ffetch
// surfaces HTTP failures would leave them all passing while production
// silently reverted to sending healthy messages to the DLQ.
//
// Here the real client, the real retry machinery and the real repository run
// together against a stubbed fetch, reproducing the exact production sequence:
// Dataverse commits the record, the response is lost or throttled, the client
// retries, and the conditional check answers 412.

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
        'retry.http.maxAttempts': 3,
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

const { createMetadataForOnlineSubmission, deriveMetadataRecordId } =
  await import('../../../src/repos/crm.js')

const DOC_TYPE_ID = '4e88916b-aae2-ee11-904c-000d3adc1ec9'
const ACTIVITY_ID = '84c190b8-5d96-f111-8076-000d3ada3978'
const CORRELATION_ID = '11111111-2222-4333-8444-555555555555'
const FILE_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa'

const request = {
  authToken: '******',
  onlineSubmissionActivityId: ACTIVITY_ID,
  metadata: { name: 'file.pdf', blobFileId: 'blob-1', documentTypeId: DOC_TYPE_ID },
  correlationId: CORRELATION_ID,
  fileId: FILE_ID
}

describe('createMetadataForOnlineSubmission — real HTTP client seam', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('resolves a transient 500 followed by a 412 as a single success', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++
      if (calls === 1) {
        return new Response('server error', { status: 500 })
      }
      return new Response('', { status: 412 })
    }))

    const result = await createMetadataForOnlineSubmission(request)

    expect(calls).toBe(2)
    expect(result).toEqual({
      metadataId: deriveMetadataRecordId(CORRELATION_ID, FILE_ID),
      error: null
    })
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: FILE_ID }),
      'Metadata record already exists, duplicate write suppressed'
    )
  })

  test('resolves an immediate 412 as a success without retrying', async () => {
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++
      return new Response('', { status: 412 })
    }))

    const result = await createMetadataForOnlineSubmission(request)

    expect(calls).toBe(1)
    expect(result.error).toBeNull()
    expect(result.metadataId).toBe(deriveMetadataRecordId(CORRELATION_ID, FILE_ID))
  })

  test('reports a genuine 409 as an error rather than suppressing it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('{"error":{"message":"conflict"}}', { status: 409 })
    ))

    const result = await createMetadataForOnlineSubmission(request)

    expect(result.metadataId).toBeNull()
    expect(result.error).toBeInstanceOf(Error)
    expect(mockLogger.info).not.toHaveBeenCalledWith(
      expect.anything(),
      'Metadata record already exists, duplicate write suppressed'
    )
  })

  test('issues a conditional PATCH against the metadata entity set', async () => {
    const fetchSpy = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchSpy)

    const result = await createMetadataForOnlineSubmission(request)

    expect(result.error).toBeNull()
    const sentRequest = fetchSpy.mock.calls[0][0]
    expect(sentRequest.method).toBe('PATCH')
    expect(sentRequest.url).toBe(
      `https://crm.example.com/api/rpa_activitymetadatas(${deriveMetadataRecordId(CORRELATION_ID, FILE_ID)})`
    )
    expect(sentRequest.headers.get('if-none-match')).toBe('*')
    expect(sentRequest.headers.get('prefer')).toBeNull()
  })
})
