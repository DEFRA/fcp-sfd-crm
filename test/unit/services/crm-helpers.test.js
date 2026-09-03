import { describe, test, expect, vi, beforeEach } from 'vitest'

const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
const mockEmitAuditEvent = vi.fn().mockResolvedValue(undefined)

vi.mock('../../../src/logging/logger.js', () => ({
  createLogger: () => mockLogger
}))

vi.mock('../../../src/repos/crm.js', () => ({
  getOnlineSubmissionActivityId: vi.fn(),
  getContactIdFromCrn: vi.fn(),
  getAccountIdFromSbi: vi.fn()
}))

vi.mock('../../../src/messaging/outbound/audit/send-audit-event.js', () => ({
  emitAuditEvent: mockEmitAuditEvent
}))

const { ensureContactAndAccount, fetchOnlineSubmissionActivityIdOrThrow, maskIdentifier } = await import('../../../src/services/crm-helpers.js')
const { getOnlineSubmissionActivityId, getContactIdFromCrn, getAccountIdFromSbi } = await import('../../../src/repos/crm.js')

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

describe('maskIdentifier', () => {
  test('masks all but the last four digits of a 10-digit CRN', () => {
    expect(maskIdentifier('1050000001')).toBe('******0001')
  })

  test('works when CRN is passed as a number', () => {
    expect(maskIdentifier(1050000001)).toBe('******0001')
  })

  test('returns string as-is when length is exactly 4', () => {
    expect(maskIdentifier('0001')).toBe('0001')
  })

  test('returns string as-is when length is less than 4', () => {
    expect(maskIdentifier('abc')).toBe('abc')
  })

  test('returns **** for null', () => {
    expect(maskIdentifier(null)).toBe('****')
  })

  test('returns **** for undefined', () => {
    expect(maskIdentifier(undefined)).toBe('****')
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

    expect(mockLogger.warn).toHaveBeenCalledWith(
      {
        event: {
          type: 'error',
          action: 'audit_correlation_id_missing',
          category: 'process',
          outcome: 'failure',
          reason: 'missing_correlation_id'
        }
      },
      expect.stringContaining('correlationId')
    )
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
    expect(thrown.triageFailureReason).toBe('contact_not_found_for_crn')
    expect(mockEmitAuditEvent).not.toHaveBeenCalled()
  })

  test('throws 422 on genuine not-found (no error, no contactId) and emits a person/read failure event', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: null })

    const thrown = await ensureContactAndAccount('token', 'crn1', 'sbi1', { correlationId: 'corr-1' }).catch(e => e)

    expect(thrown.isBoom).toBe(true)
    expect(thrown.output.statusCode).toBe(422)
    expect(thrown.triageFailureReason).toBe('contact_not_found_for_crn')
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

  // emitAuditEvent never rejects by contract. That contract is proven against
  // the real implementation in send-audit-event.test.js, and the end-to-end
  // consequence - that a failing SNS publish does not suppress the business
  // error thrown here - is proven against the real publisher and a rejecting
  // SNS client in test/integration/narrow/audit/audit-failure-isolation.test.js.

  test('masks the CRN when logging a not-found', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: null })

    await ensureContactAndAccount('token', '1050000001', 'sbi1', { correlationId: 'corr-1' }).catch(() => {})

    expect(mockLogger.error).toHaveBeenCalledWith(
      { transaction: { id: 'corr-1' } },
      'No contact found for CRN: ******0001'
    )
  })

  test('logs only the error classification, never the repo error, when the contact lookup fails', async () => {
    const err = makeNonRetryableError()
    err.responseBody = { name: 'A Farmer', crn: '1050000001' }
    getContactIdFromCrn.mockResolvedValue({ contactId: null, error: err })

    await ensureContactAndAccount('token', '1050000001', 'sbi1', { correlationId: 'corr-1' }).catch(() => {})

    const [logged, message] = mockLogger.error.mock.calls[0]
    expect(logged).toEqual({
      transaction: { id: 'corr-1' },
      error: { type: 'Error', status: 400 }
    })
    expect(message).toBe('No contact found for CRN: ******0001')
    expect(JSON.stringify(logged)).not.toContain('A Farmer')
  })

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
    expect(thrown.triageFailureReason).toBe('account_not_found_for_sbi')
    expect(mockEmitAuditEvent).toHaveBeenCalledTimes(1) // only the person/read success event
  })

  test('throws 422 on genuine not-found for account (no error, no accountId) and emits a business/read failure event', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'c1' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: null })

    const thrown = await ensureContactAndAccount('token', 'crn1', 'sbi1', { correlationId: 'corr-1' }).catch(e => e)

    expect(thrown.isBoom).toBe(true)
    expect(thrown.output.statusCode).toBe(422)
    expect(thrown.triageFailureReason).toBe('account_not_found_for_sbi')
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

  test('masks the SBI when logging a not-found, on the same terms as the CRN', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'c1' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: null })

    await ensureContactAndAccount('token', 'crn1', '106000001', { correlationId: 'corr-1' }).catch(() => {})

    expect(mockLogger.error).toHaveBeenCalledWith(
      { transaction: { id: 'corr-1' } },
      'No account found for SBI: *****0001'
    )
  })

  test('masks the SBI in the retryable account lookup error message', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'c1' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: null, error: makeRetryableError() })

    const thrown = await ensureContactAndAccount('token', 'crn1', '106000001').catch(e => e)

    expect(thrown.message).toBe('Retryable error looking up account for SBI: *****0001')
    expect(thrown.message).not.toContain('106000001')
  })

  test('logs only the error classification, never the repo error, when the account lookup fails', async () => {
    const err = makeNonRetryableError()
    err.responseBody = { businessName: 'A Farm Ltd', sbi: '106000001' }
    getContactIdFromCrn.mockResolvedValue({ contactId: 'c1' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: null, error: err })

    await ensureContactAndAccount('token', 'crn1', '106000001', { correlationId: 'corr-1' }).catch(() => {})

    const [logged] = mockLogger.error.mock.calls[0]
    expect(logged).toEqual({
      transaction: { id: 'corr-1' },
      error: { type: 'Error', status: 400 }
    })
    expect(JSON.stringify(logged)).not.toContain('A Farm Ltd')
  })
})

describe('fetchOnlineSubmissionActivityIdOrThrow', () => {
  test('returns the submission ID on success', async () => {
    getOnlineSubmissionActivityId.mockResolvedValue({ onlineSubmissionActivityId: '84c190b8-5d96-f111-8076-000d3ada3978', error: null })

    const result = await fetchOnlineSubmissionActivityIdOrThrow('token', 'case-1', { correlationId: 'corr-1' })

    expect(result).toBe('84c190b8-5d96-f111-8076-000d3ada3978')
  })

  test('throws with retryable=true when repo returns a retryable HTTP error', async () => {
    const err = makeRetryableError()
    getOnlineSubmissionActivityId.mockResolvedValue({ onlineSubmissionActivityId: null, error: err })

    const thrown = await fetchOnlineSubmissionActivityIdOrThrow('token', 'case-1', { correlationId: 'corr-1' }).catch(e => e)

    expect(thrown.retryable).toBe(true)
    expect(thrown.retryMetadata).toEqual(err.retryMetadata)
    expect(thrown.message).toBe('Failed to retrieve online submission id')
  })

  test('throws with retryable=false when repo returns a non-retryable HTTP error', async () => {
    getOnlineSubmissionActivityId.mockResolvedValue({ onlineSubmissionActivityId: null, error: makeNonRetryableError() })

    const thrown = await fetchOnlineSubmissionActivityIdOrThrow('token', 'case-1', { correlationId: 'corr-1' }).catch(e => e)

    expect(thrown.retryable).toBe(false)
    expect(thrown.message).toBe('Failed to retrieve online submission id')
  })

  test('throws with retryable=true when the submission is not yet queryable', async () => {
    getOnlineSubmissionActivityId.mockResolvedValue({ onlineSubmissionActivityId: null, error: null })

    const thrown = await fetchOnlineSubmissionActivityIdOrThrow('token', 'case-1', { fileId: 'file-1' }).catch(e => e)

    expect(thrown.retryable).toBe(true)
    expect(thrown.retryMetadata).toEqual({ category: 'retryable', terminalReason: 'online_submission_not_yet_queryable' })
    expect(thrown.message).toBe('Failed to retrieve online submission id')
  })

  test('logs the CRM rejection reason on event.reason and the error under the error key', async () => {
    const err = makeNonRetryableError()
    err.crmError = 'CRM rejected the lookup'
    getOnlineSubmissionActivityId.mockResolvedValue({ onlineSubmissionActivityId: null, error: err })

    await fetchOnlineSubmissionActivityIdOrThrow('token', 'case-1', { fileId: 'file-1' }).catch(e => e)

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        error: err,
        fileId: 'file-1',
        event: expect.objectContaining({
          reference: 'case-1',
          reason: 'CRM rejected the lookup'
        })
      }),
      'Failed to retrieve online submission id'
    )
  })

  test('works without context argument', async () => {
    getOnlineSubmissionActivityId.mockResolvedValue({ onlineSubmissionActivityId: null, error: makeNonRetryableError() })

    const thrown = await fetchOnlineSubmissionActivityIdOrThrow('token', 'case-1').catch(e => e)

    expect(thrown.retryable).toBe(false)
  })
})
