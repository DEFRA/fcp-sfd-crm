import { describe, test, expect, vi, beforeEach } from 'vitest'


const mockLogger = { info: vi.fn(), error: vi.fn() }
const mockSendAuditEvent = vi.fn().mockResolvedValue(true)

vi.mock('../../../src/logging/logger.js', () => ({
  createLogger: () => mockLogger
}))

vi.mock('../../../src/config/index.js', () => ({
  config: {
    get: vi.fn(() => null)
  }
}))

vi.mock('../../../src/messaging/outbound/audit/send-audit-event.js', () => ({
  sendAuditEvent: mockSendAuditEvent
}))

vi.mock('../../../src/repos/crm.js', () => ({
  getOnlineSubmissionId: vi.fn(),
  getContactIdFromCrn: vi.fn(),
  getAccountIdFromSbi: vi.fn()
}))

const { ensureContactAndAccount, fetchRpaOnlineSubmissionIdOrThrow } = await import('../../../src/services/crm-helpers.js')
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

describe('ensureContactAndAccount', () => {
  test('returns contactId and accountId on success', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'c1' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: 'a1' })

    const result = await ensureContactAndAccount('token', 'crn1', 'sbi1', 'corr-1')

    expect(result).toEqual({ contactId: 'c1', accountId: 'a1' })
    await new Promise(r => setImmediate(r))
    expect(mockSendAuditEvent).toHaveBeenCalledTimes(2)
  })

  test('throws with retryable=true when contact lookup gets a retryable HTTP error', async () => {
    const err = makeRetryableError()
    getContactIdFromCrn.mockResolvedValue({ contactId: null, error: err })

    const thrown = await ensureContactAndAccount('token', 'crn1', 'sbi1').catch(e => e)

    expect(thrown.retryable).toBe(true)
    expect(thrown.retryMetadata).toEqual(err.retryMetadata)
    expect(thrown.message).toContain('Retryable error looking up contact')
  })

  test('logs audit_publish_failed when person.read audit send fails but continues flow', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'c1' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: 'a1' })
    mockSendAuditEvent
      .mockRejectedValueOnce(new Error('schema invalid'))
      .mockResolvedValueOnce(true)

    const result = await ensureContactAndAccount('token', 'crn1', 'sbi1', 'corr-2')
    await new Promise(r => setImmediate(r))

    expect(result).toEqual({ contactId: 'c1', accountId: 'a1' })
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: expect.objectContaining({ type: 'uk.gov.fcp.sfd.person.read' }) }),
      'audit_publish_failed'
    )
  })

  test('logs audit_publish_failed when business.read audit send fails but continues flow', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'c1' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: 'a1' })
    mockSendAuditEvent
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('transport failure'))

    const result = await ensureContactAndAccount('token', 'crn1', 'sbi1', 'corr-3')
    await new Promise(r => setImmediate(r))

    expect(result).toEqual({ contactId: 'c1', accountId: 'a1' })
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: expect.objectContaining({ type: 'uk.gov.fcp.sfd.business.read' }) }),
      'audit_publish_failed'
    )
  })

  test('throws 422 when contact lookup gets a non-retryable HTTP error', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: null, error: makeNonRetryableError() })

    const thrown = await ensureContactAndAccount('token', 'crn1', 'sbi1').catch(e => e)

    expect(thrown.isBoom).toBe(true)
    expect(thrown.output.statusCode).toBe(422)
    expect(thrown.retryable).toBeUndefined()
  })

  test('throws 422 on genuine not-found (no error, no contactId)', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: null })

    const thrown = await ensureContactAndAccount('token', 'crn1', 'sbi1', 'corr-1').catch(e => e)

    expect(thrown.isBoom).toBe(true)
    expect(thrown.output.statusCode).toBe(422)
    expect(mockSendAuditEvent).toHaveBeenCalledWith({
      correlationId: 'corr-1',
      accounts: { crn: 'crn1', sbi: 'sbi1' },
      audit: { status: 'failure', details: 'CRN not found' }
    })
  })

  test('still throws 422 when contact not found and audit send fails', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: null })
    mockSendAuditEvent.mockRejectedValueOnce(new Error('audit down'))

    const thrown = await ensureContactAndAccount('token', 'crn1', 'sbi1', 'corr-6').catch(e => e)

    expect(thrown.isBoom).toBe(true)
    expect(thrown.output.statusCode).toBe(422)
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: expect.objectContaining({ type: 'uk.gov.fcp.sfd.person.read' }) }),
      'audit_publish_failed'
    )
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

  test('throws 422 when account lookup gets a non-retryable HTTP error', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'c1' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: null, error: makeNonRetryableError() })

    const thrown = await ensureContactAndAccount('token', 'crn1', 'sbi1').catch(e => e)

    expect(thrown.isBoom).toBe(true)
    expect(thrown.output.statusCode).toBe(422)
  })

  test('throws 422 on genuine not-found for account (no error, no accountId)', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'c1' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: null })

    const thrown = await ensureContactAndAccount('token', 'crn1', 'sbi1', 'corr-1').catch(e => e)

    expect(thrown.isBoom).toBe(true)
    expect(thrown.output.statusCode).toBe(422)
    expect(mockSendAuditEvent).toHaveBeenCalledWith({
      correlationId: 'corr-1',
      accounts: { sbi: 'sbi1' },
      audit: { status: 'failure', details: 'SBI not found' }
    })
  })

  test('still throws 422 when account not found and audit send fails', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'c1' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: null })
    mockSendAuditEvent.mockRejectedValue(new Error('audit down'))

    const thrown = await ensureContactAndAccount('token', 'crn1', 'sbi1', 'corr-7').catch(e => e)

    expect(thrown.isBoom).toBe(true)
    expect(thrown.output.statusCode).toBe(422)
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: expect.objectContaining({ type: 'uk.gov.fcp.sfd.business.read' }) }),
      'audit_publish_failed'
    )
  })
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
