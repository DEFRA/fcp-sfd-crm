import { describe, test, expect, vi, beforeEach } from 'vitest'

const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
const mockEmitAuditEvent = vi.fn().mockResolvedValue(undefined)

vi.mock('../../../src/logging/logger.js', () => ({
  createLogger: () => mockLogger
}))

vi.mock('../../../src/repos/crm.js', () => ({
  getOnlineSubmissionId: vi.fn(),
  getContactIdFromCrn: vi.fn(),
  getAccountIdFromSbi: vi.fn()
}))

vi.mock('../../../src/messaging/outbound/audit/send-audit-event.js', () => ({
  emitAuditEvent: mockEmitAuditEvent
}))

const { ensureContactAndAccount, fetchRpaOnlineSubmissionIdOrThrow, maskCrn } = await import('../../../src/services/crm-helpers.js')
const { getOnlineSubmissionId, getContactIdFromCrn, getAccountIdFromSbi } = await import('../../../src/repos/crm.js')

const makeRetryableError = () => {
  const err = new Error('Service unavailable')
  err.retryMetadata = { category: 'retryable', terminalReason: 'http_503', status: 503 }
  return err
}

const makeNonRetryableError = () => {
  const err = new Error('Bad request')
  err.retryMetadata = { category: 'non-retryable', terminalReason: 'http_400', status: 400 }
  return err
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('maskCrn', () => {
  test('masks all but the last four digits of a 10-digit CRN', () => {
    expect(maskCrn('1050000001')).toBe('******0001')
  })

  test('works when CRN is passed as a number', () => {
    expect(maskCrn(1050000001)).toBe('******0001')
  })

  test('returns string as-is when length is exactly 4', () => {
    expect(maskCrn('0001')).toBe('0001')
  })

  test('returns string as-is when length is less than 4', () => {
    expect(maskCrn('abc')).toBe('abc')
  })

  test('returns **** for null', () => {
    expect(maskCrn(null)).toBe('****')
  })

  test('returns **** for undefined', () => {
    expect(maskCrn(undefined)).toBe('****')
  })
})

describe('ensureContactAndAccount', () => {
  test('returns contactId and accountId on success', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'c1' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: 'a1' })

    const result = await ensureContactAndAccount('token', 'crn1', 'sbi1', { correlationId: 'corr-1' })

    expect(result).toEqual({ contactId: 'c1', accountId: 'a1' })
  })

  test('warns when called without a correlationId, since emitted events would fail schema validation', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'c1' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: 'a1' })

    await ensureContactAndAccount('token', 'crn1', 'sbi1')

    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('correlationId'))
  })

  test('does not warn when a correlationId is supplied', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'c1' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: 'a1' })

    await ensureContactAndAccount('token', 'crn1', 'sbi1', { correlationId: 'corr-1' })

    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  test('emits a person/read success audit event with contactId and CRN', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'c1' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: 'a1' })

    await ensureContactAndAccount('token', 'crn1', 'sbi1', { correlationId: 'corr-1' })

    expect(mockEmitAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      correlationid: 'corr-1',
      audit: expect.objectContaining({
        entities: [{ entity: 'person', action: 'read', entityid: 'c1' }],
        accounts: { crn: 'crn1' },
        status: 'success'
      })
    }))
  })

  test('emits a business/read success audit event with accountId and SBI', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'c1' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: 'a1' })

    await ensureContactAndAccount('token', 'crn1', 'sbi1', { correlationId: 'corr-1' })

    expect(mockEmitAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      correlationid: 'corr-1',
      audit: expect.objectContaining({
        entities: [{ entity: 'business', action: 'read', entityid: 'a1' }],
        accounts: { sbi: 'sbi1' },
        status: 'success'
      })
    }))
  })

  test('throws with retryable=true when contact lookup gets a retryable HTTP error', async () => {
    const err = makeRetryableError()
    getContactIdFromCrn.mockResolvedValue({ contactId: null, error: err })

    const thrown = await ensureContactAndAccount('token', 'crn1', 'sbi1').catch(e => e)

    expect(thrown.retryable).toBe(true)
    expect(thrown.retryMetadata).toEqual(err.retryMetadata)
    expect(thrown.message).toContain('Retryable error looking up contact')
    expect(mockEmitAuditEvent).not.toHaveBeenCalled()
  })

  test('throws 422 when contact lookup gets a non-retryable HTTP error, without emitting a not-found event', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: null, error: makeNonRetryableError() })

    const thrown = await ensureContactAndAccount('token', 'crn1', 'sbi1').catch(e => e)

    expect(thrown.isBoom).toBe(true)
    expect(thrown.output.statusCode).toBe(422)
    expect(thrown.retryable).toBeUndefined()
    expect(mockEmitAuditEvent).not.toHaveBeenCalled()
  })

  test('throws 422 on genuine not-found (no error, no contactId) and emits a person/read failure event', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: null })

    const thrown = await ensureContactAndAccount('token', 'crn1', 'sbi1', { correlationId: 'corr-1' }).catch(e => e)

    expect(thrown.isBoom).toBe(true)
    expect(thrown.output.statusCode).toBe(422)
    expect(mockEmitAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      correlationid: 'corr-1',
      audit: expect.objectContaining({
        entities: [{ entity: 'person', action: 'read', entityid: '' }],
        accounts: { crn: 'crn1' },
        status: 'failure',
        details: { reason: 'CRN not found' }
      })
    }))
  })

  // emitAuditEvent (the shared wrapper in send-audit-event.js) never rejects
  // by contract - that guarantee is proven directly in
  // send-audit-event.test.js. Forcing the mock here to reject would only
  // test a contract violation that cannot occur through the real
  // implementation, so it is not asserted at this call site.

  test('throws with retryable=true when account lookup gets a retryable HTTP error', async () => {
    const err = makeRetryableError()
    getContactIdFromCrn.mockResolvedValue({ contactId: 'c1' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: null, error: err })

    const thrown = await ensureContactAndAccount('token', 'crn1', 'sbi1').catch(e => e)

    expect(thrown.retryable).toBe(true)
    expect(thrown.retryMetadata).toEqual(err.retryMetadata)
    expect(thrown.message).toContain('Retryable error looking up account')
  })

  test('throws 422 when account lookup gets a non-retryable HTTP error, without emitting a not-found event', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'c1' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: null, error: makeNonRetryableError() })

    const thrown = await ensureContactAndAccount('token', 'crn1', 'sbi1').catch(e => e)

    expect(thrown.isBoom).toBe(true)
    expect(thrown.output.statusCode).toBe(422)
    expect(mockEmitAuditEvent).toHaveBeenCalledTimes(1) // only the person/read success event
  })

  test('throws 422 on genuine not-found for account (no error, no accountId) and emits a business/read failure event', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'c1' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: null })

    const thrown = await ensureContactAndAccount('token', 'crn1', 'sbi1', { correlationId: 'corr-1' }).catch(e => e)

    expect(thrown.isBoom).toBe(true)
    expect(thrown.output.statusCode).toBe(422)
    expect(mockEmitAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      correlationid: 'corr-1',
      audit: expect.objectContaining({
        entities: [{ entity: 'business', action: 'read', entityid: '' }],
        accounts: { sbi: 'sbi1' },
        status: 'failure',
        details: { reason: 'SBI not found' }
      })
    }))
  })

  // See note above: emitAuditEvent's non-rejecting contract is proven in
  // send-audit-event.test.js, so a "still throws when audit fails" test is
  // not repeated here.
})

describe('fetchRpaOnlineSubmissionIdOrThrow', () => {
  test('returns the submission ID on success', async () => {
    getOnlineSubmissionId.mockResolvedValue({ rpaOnlinesubmissionid: 'sub-1', error: null })

    const result = await fetchRpaOnlineSubmissionIdOrThrow('token', 'case-1', { correlationId: 'corr-1' })

    expect(result).toBe('sub-1')
  })

  test('throws with retryable=true when repo returns a retryable HTTP error', async () => {
    const err = makeRetryableError()
    getOnlineSubmissionId.mockResolvedValue({ rpaOnlinesubmissionid: null, error: err })

    const thrown = await fetchRpaOnlineSubmissionIdOrThrow('token', 'case-1', { correlationId: 'corr-1' }).catch(e => e)

    expect(thrown.retryable).toBe(true)
    expect(thrown.retryMetadata).toEqual(err.retryMetadata)
    expect(thrown.message).toBe('Failed to retrieve online submission id')
  })

  test('throws with retryable=false when repo returns a non-retryable HTTP error', async () => {
    getOnlineSubmissionId.mockResolvedValue({ rpaOnlinesubmissionid: null, error: makeNonRetryableError() })

    const thrown = await fetchRpaOnlineSubmissionIdOrThrow('token', 'case-1', { correlationId: 'corr-1' }).catch(e => e)

    expect(thrown.retryable).toBe(false)
    expect(thrown.message).toBe('Failed to retrieve online submission id')
  })

  test('throws with retryable=false when submission ID is genuinely not found (no error)', async () => {
    getOnlineSubmissionId.mockResolvedValue({ rpaOnlinesubmissionid: null, error: null })

    const thrown = await fetchRpaOnlineSubmissionIdOrThrow('token', 'case-1', { correlationId: 'corr-1' }).catch(e => e)

    expect(thrown.retryable).toBe(false)
    expect(thrown.message).toBe('Failed to retrieve online submission id')
  })

  test('works without context argument', async () => {
    getOnlineSubmissionId.mockResolvedValue({ rpaOnlinesubmissionid: null, error: makeNonRetryableError() })

    const thrown = await fetchRpaOnlineSubmissionIdOrThrow('token', 'case-1').catch(e => e)

    expect(thrown.retryable).toBe(false)
  })
})
