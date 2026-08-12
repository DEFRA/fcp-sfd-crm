import { describe, test, expect, beforeEach, vi } from 'vitest'
import { validateAuditEvent } from '@defra/fcp-audit-publisher'

// Boundary mocks only: CRM API, case persistence and SNS transport. Every
// audit event still passes through the real builder functions, the real
// sendAuditEvent wrapper and the real publishAuditEvent/validateAuditEvent
// from @defra/fcp-audit-publisher, so this test proves that every event this
// service can emit is schema-valid end to end.
vi.mock('../../../../src/messaging/sns/client.js', () => ({
  snsClient: { send: vi.fn().mockResolvedValue({ MessageId: 'sns-message-id' }) }
}))

vi.mock('../../../../src/auth/get-crm-auth-token.js', () => ({
  getCrmAuthToken: vi.fn().mockResolvedValue('mock-token')
}))

vi.mock('../../../../src/repos/crm.js', () => ({
  getContactIdFromCrn: vi.fn(),
  getAccountIdFromSbi: vi.fn(),
  createCaseWithOnlineSubmission: vi.fn(),
  getOnlineSubmissionId: vi.fn(),
  getCaseIdByOnlineSubmissionId: vi.fn(),
  createMetadataForOnlineSubmission: vi.fn(),
  createMetadataForExistingCase: vi.fn(),
  getDocumentTypeMetadata: vi.fn().mockResolvedValue({ documentTypeMetadata: { documentTypeId: 'doc-type-1' } })
}))

vi.mock('../../../../src/messaging/outbound/received-event/publish-received-event.js', () => ({
  publishReceivedEvent: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../../../../src/repos/cases.js', () => ({
  setCorrelationIdIndex: vi.fn(),
  upsertCase: vi.fn(),
  markFileProcessed: vi.fn().mockResolvedValue(undefined),
  updateCaseId: vi.fn().mockResolvedValue(undefined)
}))

const { snsClient } = await import('../../../../src/messaging/sns/client.js')
const { getContactIdFromCrn, getAccountIdFromSbi, createCaseWithOnlineSubmission, createMetadataForOnlineSubmission } = await import('../../../../src/repos/crm.js')
const { upsertCase } = await import('../../../../src/repos/cases.js')
const { ensureContactAndAccount } = await import('../../../../src/services/crm-helpers.js')
const { createCase } = await import('../../../../src/services/case.js')
const { sendAuditEvent } = await import('../../../../src/messaging/outbound/audit/send-audit-event.js')
const { buildCredentialFailureEvent } = await import('../../../../src/messaging/outbound/audit/build-audit-event.js')

const CORRELATION_ID = 'audit-integration-correlation-id'

// Every event this test triggers ends up as an SNS PublishCommand's Message
// body, so decoding those calls gives us the exact payload passed to
// publishAuditEvent (and therefore validateAuditEvent) for each one.
const publishedEvents = () =>
  snsClient.send.mock.calls.map(([command]) => JSON.parse(command.input.Message))

const expectAllValid = (events) => {
  for (const event of events) {
    const { valid, errors } = validateAuditEvent(event)
    expect(valid, `event failed schema validation: ${JSON.stringify(errors)} for ${JSON.stringify(event)}`).toBe(true)
  }
}

describe('Integration - audit events conform to the fcp-audit-publisher schema', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    snsClient.send.mockResolvedValue({ MessageId: 'sns-message-id' })
  })

  test('rows 3 and 4: person/read and business/read emitted on successful lookups', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'contact-1' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: 'account-1' })

    await ensureContactAndAccount('token', 'crn-1', 'sbi-1', { correlationId: CORRELATION_ID })

    const events = publishedEvents()
    expect(events).toHaveLength(2)
    expectAllValid(events)

    expect(events[0]).toMatchObject({
      correlationid: CORRELATION_ID,
      audit: { entities: [{ entity: 'person', action: 'read', entityid: 'contact-1' }], status: 'success', accounts: { crn: 'crn-1' } }
    })
    expect(events[1]).toMatchObject({
      correlationid: CORRELATION_ID,
      audit: { entities: [{ entity: 'business', action: 'read', entityid: 'account-1' }], status: 'success', accounts: { sbi: 'sbi-1' } }
    })
  })

  test('row 5: person/read failure emitted when the CRN has no match', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: null })

    await expect(ensureContactAndAccount('token', 'crn-missing', 'sbi-1', { correlationId: CORRELATION_ID }))
      .rejects.toThrow('Contact ID not found')

    const events = publishedEvents()
    expect(events).toHaveLength(1)
    expectAllValid(events)
    expect(events[0]).toMatchObject({
      correlationid: CORRELATION_ID,
      audit: { entities: [{ entity: 'person', action: 'read', entityid: '' }], status: 'failure', details: { reason: 'CRN not found' } }
    })
  })

  test('row 6: business/read failure emitted when the SBI has no match', async () => {
    getContactIdFromCrn.mockResolvedValue({ contactId: 'contact-1' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: null })

    await expect(ensureContactAndAccount('token', 'crn-1', 'sbi-missing', { correlationId: CORRELATION_ID }))
      .rejects.toThrow('Account ID not found')

    const events = publishedEvents()
    expect(events).toHaveLength(2)
    expectAllValid(events)
    expect(events[1]).toMatchObject({
      correlationid: CORRELATION_ID,
      audit: { entities: [{ entity: 'business', action: 'read', entityid: '' }], status: 'failure', details: { reason: 'SBI not found' } }
    })
  })

  test('row 1: document/created emitted with caseId after case creation', async () => {
    upsertCase.mockResolvedValue({ isNew: true, isDuplicateFile: false, caseId: null, isCreator: true })
    getContactIdFromCrn.mockResolvedValue({ contactId: 'contact-1' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: 'account-1' })
    createCaseWithOnlineSubmission.mockResolvedValue({ caseId: 'case-1', contactId: 'contact-1', accountId: 'account-1' })

    const payload = {
      data: {
        crn: 'crn-1',
        sbi: 'sbi-1',
        crm: { title: 'Integration Test' },
        file: { fileId: 'file-1', fileName: 'file.pdf', url: 'http://file', contentType: 'application/pdf' },
        correlationId: CORRELATION_ID
      }
    }

    await createCase(payload)

    const events = publishedEvents()
    // Case creation resolves the contact and account first, so this also
    // emits person/read and business/read (rows 3 and 4) ahead of the
    // document/created event under test here.
    expect(events).toHaveLength(3)
    expectAllValid(events)
    const documentEvent = events.find(event => event.audit.entities[0].entity === 'document')
    expect(documentEvent).toMatchObject({
      correlationid: CORRELATION_ID,
      audit: { entities: [{ entity: 'document', action: 'created', entityid: 'case-1' }], status: 'success', accounts: { crn: 'crn-1', sbi: 'sbi-1' } }
    })
  })

  test('row 2: document/created emitted with metadataId after document attachment', async () => {
    upsertCase.mockResolvedValue({ isNew: false, isDuplicateFile: false, caseId: 'case-2', isCreator: false })
    createMetadataForOnlineSubmission.mockResolvedValue({ metadataId: 'metadata-1' })

    const payload = {
      data: {
        crn: 'crn-1',
        sbi: 'sbi-1',
        crm: { title: 'Integration Test' },
        file: { fileId: 'file-2', fileName: 'file.pdf', url: 'http://file', contentType: 'application/pdf' },
        correlationId: CORRELATION_ID
      }
    }

    // addMetadataToExistingCase calls fetchRpaOnlineSubmissionIdOrThrow, which
    // in turn needs getOnlineSubmissionId to resolve.
    const { getOnlineSubmissionId } = await import('../../../../src/repos/crm.js')
    getOnlineSubmissionId.mockResolvedValue({ rpaOnlinesubmissionid: 'rpa-1' })

    await createCase(payload)

    const events = publishedEvents()
    expect(events).toHaveLength(1)
    expectAllValid(events)
    expect(events[0]).toMatchObject({
      correlationid: CORRELATION_ID,
      audit: { entities: [{ entity: 'document', action: 'created', entityid: 'metadata-1' }], status: 'success', accounts: { crn: 'crn-1', sbi: 'sbi-1' } }
    })
  })

  test('the full create-then-attach flow emits document/created twice with a shared correlationid', async () => {
    upsertCase
      .mockResolvedValueOnce({ isNew: true, isDuplicateFile: false, caseId: null, isCreator: true })
      .mockResolvedValueOnce({ isNew: false, isDuplicateFile: false, caseId: 'case-3', isCreator: false })
    getContactIdFromCrn.mockResolvedValue({ contactId: 'contact-1' })
    getAccountIdFromSbi.mockResolvedValue({ accountId: 'account-1' })
    createCaseWithOnlineSubmission.mockResolvedValue({ caseId: 'case-3', contactId: 'contact-1', accountId: 'account-1' })
    createMetadataForOnlineSubmission.mockResolvedValue({ metadataId: 'metadata-3' })
    const { getOnlineSubmissionId } = await import('../../../../src/repos/crm.js')
    getOnlineSubmissionId.mockResolvedValue({ rpaOnlinesubmissionid: 'rpa-3' })

    const firstFilePayload = {
      data: {
        crn: 'crn-1',
        sbi: 'sbi-1',
        crm: { title: 'Integration Test' },
        file: { fileId: 'file-3a', fileName: 'file.pdf', url: 'http://file', contentType: 'application/pdf' },
        correlationId: CORRELATION_ID
      }
    }
    const secondFilePayload = {
      data: {
        ...firstFilePayload.data,
        file: { fileId: 'file-3b', fileName: 'file2.pdf', url: 'http://file2', contentType: 'application/pdf' }
      }
    }

    await createCase(firstFilePayload)
    await createCase(secondFilePayload)

    const events = publishedEvents()
    // First call also resolves the contact and account (person/read, business/read)
    // before the case itself is created, so four events are published in total.
    expect(events).toHaveLength(4)
    expectAllValid(events)
    expect(events.every(event => event.correlationid === CORRELATION_ID)).toBe(true)

    const documentEvents = events.filter(event => event.audit.entities[0].entity === 'document')
    expect(documentEvents.map(event => event.audit.entities[0].entityid)).toEqual(['case-3', 'metadata-3'])
  })

  test('row 7: security event for invalid or missing credentials carries both security and audit objects', async () => {
    await sendAuditEvent(buildCredentialFailureEvent({
      correlationId: CORRELATION_ID,
      reason: 'Missing or invalid QA-specific x-api-key header'
    }))

    const events = publishedEvents()
    expect(events).toHaveLength(1)
    expectAllValid(events)
    expect(events[0]).toMatchObject({
      correlationid: CORRELATION_ID,
      security: { pmccode: expect.any(String), details: { message: 'Missing or invalid QA-specific x-api-key header' } },
      audit: { status: 'failure' }
    })
  })
})
