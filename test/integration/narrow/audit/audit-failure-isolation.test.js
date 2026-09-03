import { describe, test, expect, beforeEach, vi } from 'vitest'

// Audit failure must never change the outcome of message processing. Proving
// that requires the real audit path to run and really fail, so the only
// things mocked here are the true boundaries: the CRM API, case persistence,
// the SQS transport and the SNS transport. The consumer, the case service,
// crm-helpers, the event builders, emitAuditEvent and the real
// publishAuditEvent from @defra/fcp-audit-publisher all execute.
//
// consumer.test.js cannot prove this: it mocks services/case.js wholesale, so
// no audit code runs there at all.
let capturedHandleMessage = null

vi.mock('sqs-consumer', () => ({
  Consumer: {
    create: ({ handleMessage }) => {
      capturedHandleMessage = handleMessage
      return { on: vi.fn(), start: vi.fn(), stop: vi.fn() }
    }
  }
}))

vi.mock('../../../../src/messaging/sns/client.js', () => ({
  snsClient: { send: vi.fn() }
}))

// Shared by every module under test, so the audit publish failure logged by
// send-audit-event.js is visible to the assertions below.
const logger = { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() }

vi.mock('../../../../src/logging/logger.js', () => ({
  createLogger: () => logger
}))

vi.mock('../../../../src/auth/get-crm-auth-token.js', () => ({
  getCrmAuthToken: vi.fn().mockResolvedValue('mock-token')
}))

vi.mock('../../../../src/repos/crm.js', () => ({
  getContactIdFromCrn: vi.fn(),
  getAccountIdFromSbi: vi.fn(),
  createCaseWithOnlineSubmission: vi.fn(),
  getOnlineSubmissionActivityId: vi.fn(),
  createMetadataForOnlineSubmission: vi.fn(),
  getDocumentTypeMetadata: vi.fn().mockResolvedValue({ documentTypeMetadata: { documentTypesId: 'doc-type-1' } }),
  deriveMetadataRecordId: vi.fn(),
  deriveCaseRecordId: vi.fn(),
  deriveOnlineSubmissionRecordId: vi.fn()
}))

vi.mock('../../../../src/messaging/outbound/received-event/publish-received-event.js', () => ({
  publishReceivedEvent: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../../../../src/repos/cases.js', () => ({
  setCorrelationIdIndex: vi.fn(),
  upsertCase: vi.fn(),
  markFileProcessed: vi.fn().mockResolvedValue(undefined),
  updateCaseId: vi.fn().mockResolvedValue(undefined),
  claimCreatorRole: vi.fn().mockResolvedValue(false),
  releaseCreator: vi.fn().mockResolvedValue(undefined)
}))

const { snsClient } = await import('../../../../src/messaging/sns/client.js')
const { getContactIdFromCrn, getAccountIdFromSbi, createCaseWithOnlineSubmission } = await import('../../../../src/repos/crm.js')
const { upsertCase, updateCaseId } = await import('../../../../src/repos/cases.js')
const { startCRMListener } = await import('../../../../src/messaging/inbound/consumer.js')
const { ensureContactAndAccount } = await import('../../../../src/services/crm-helpers.js')

const sqsClient = { config: { endpoint: 'mock-endpoint' }, send: vi.fn().mockResolvedValue({}) }

const CORRELATION_ID = '550e8400-e29b-41d4-a716-446655440000'
const CRN = '1050000001'
const SBI = '106000001'

const message = (fileId) => ({
  MessageId: `msg-${fileId}`,
  Body: JSON.stringify({
    id: `evt-${fileId}`,
    source: '/test',
    specversion: '1.0',
    type: 'test.type',
    datacontenttype: 'application/json',
    time: new Date().toISOString(),
    data: {
      crn: CRN,
      sbi: SBI,
      file: { fileId, fileName: 'file.pdf', url: 'https://example.com/api/v1/blob/' + fileId },
      correlationId: CORRELATION_ID,
      sourceSystem: 'fcp-sfd-frontend',
      submissionId: 'sub-1'
    }
  })
})

describe('Integration - audit failure is isolated from message processing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Every audit publish attempted in this file fails at the SNS transport.
    snsClient.send.mockRejectedValue(new Error('SNS unavailable'))
    getContactIdFromCrn.mockResolvedValue({ contactId: 'contact-1' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: 'account-1' })
    createCaseWithOnlineSubmission.mockResolvedValue({ caseId: 'case-1', contactId: 'contact-1', accountId: 'account-1' })
    upsertCase.mockResolvedValue({ isNew: true, isDuplicateFile: false, caseId: null, isCreator: true })
    startCRMListener(sqsClient)
  })

  test('a successful case creation still returns the message for deletion when every audit publish fails', async () => {
    const msg = message('3fa85f64-5717-4562-b3fc-2c963f66af01')

    const result = await capturedHandleMessage(msg)

    expect(snsClient.send).toHaveBeenCalled()
    // The message is returned for deletion because the case was genuinely
    // created, not because it was routed to the DLQ, which returns the
    // message too.
    expect(createCaseWithOnlineSubmission).toHaveBeenCalled()
    expect(updateCaseId).toHaveBeenCalledWith(CORRELATION_ID, 'case-1')
    expect(sqsClient.send).not.toHaveBeenCalled()
    expect(result).toEqual(msg)
  })

  // The lookups that emit person/read and business/read succeed first in both
  // cases below, so an audit publish is attempted and fails before the case
  // creation error is raised.
  test('a retryable failure still leaves the message on the queue when every audit publish fails', async () => {
    createCaseWithOnlineSubmission.mockResolvedValueOnce({
      error: { message: 'CRM unavailable', retryMetadata: { category: 'retryable', status: 503 } }
    })

    const result = await capturedHandleMessage(message('3fa85f64-5717-4562-b3fc-2c963f66af02'))

    expect(snsClient.send).toHaveBeenCalled()
    expect(result).toBeUndefined()
  })

  test('a non-retryable failure still routes to the DLQ when every audit publish fails', async () => {
    createCaseWithOnlineSubmission.mockResolvedValueOnce({
      error: { message: 'CRM rejected the case', retryMetadata: { category: 'non-retryable', status: 400 } }
    })

    const msg = message('3fa85f64-5717-4562-b3fc-2c963f66af03')
    const result = await capturedHandleMessage(msg)

    expect(sqsClient.send).toHaveBeenCalled()
    expect(result).toEqual(msg)
  })

  test('no audit error reaches the SQS handler, which reports only the failure classification', async () => {
    await capturedHandleMessage(message('3fa85f64-5717-4562-b3fc-2c963f66af04'))

    const auditFailures = logger.error.mock.calls.filter(([payload]) => payload?.event?.action === 'audit_publish_failed')
    expect(auditFailures.length).toBeGreaterThan(0)

    for (const [payload] of auditFailures) {
      expect(payload.event.type).toBe('error')
      expect(payload.event.reason).toBe('transport')
      expect(payload.event.reference).toBe(CORRELATION_ID)
      expect(payload.error).toEqual({ type: 'Error' })
      // Sanitised: no identifiers, tokens or payload fragments.
      const serialised = JSON.stringify(payload)
      expect(serialised).not.toContain(CRN)
      expect(serialised).not.toContain(SBI)
      expect(serialised).not.toContain('mock-token')
    }
  })

  test('a failing audit publish does not suppress the not-found business error', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: null })

    await expect(ensureContactAndAccount('token', 'crn-missing', 'sbi-1', { correlationId: CORRELATION_ID }))
      .rejects.toThrow('Contact ID not found')

    expect(snsClient.send).toHaveBeenCalled()
  })

  test('a failing audit publish does not suppress the SBI not-found business error', async () => {
    getAccountIdFromSbi.mockResolvedValue({ accountId: null })

    await expect(ensureContactAndAccount('token', 'crn-1', 'sbi-missing', { correlationId: CORRELATION_ID }))
      .rejects.toThrow('Account ID not found')

    expect(snsClient.send).toHaveBeenCalled()
  })
})
