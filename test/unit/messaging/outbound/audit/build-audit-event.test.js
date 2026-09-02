import { describe, test, expect } from 'vitest'
import { validateAuditEvent } from '@defra/fcp-audit-publisher'
import {
  buildDocumentCreatedEvent,
  buildPersonReadEvent,
  buildBusinessReadEvent
} from '../../../../../src/messaging/outbound/audit/build-audit-event.js'

// publishAuditEvent (the real transport) applies these defaults before
// validation and dispatch. Mirror that here so builder output can be
// validated in isolation, matching how the events will look on the wire.
// correlationid mirrors the publisher's generateCorrelationId default: it is
// only used when the builder itself did not supply one.
const withPublishDefaults = (event) => ({
  datetime: new Date().toISOString(),
  environment: 'test',
  version: '1.0.0',
  application: 'fcp-sfd-crm',
  component: 'fcp-sfd-crm',
  ip: '0.0.0.0',
  correlationid: 'generated-correlation-id',
  ...event
})

const assertValid = (event) => {
  const { valid, errors } = validateAuditEvent(withPublishDefaults(event))
  expect(errors ?? []).toEqual([])
  expect(valid).toBe(true)
}

describe('buildDocumentCreatedEvent', () => {
  test('builds a valid document/created event with caseId', () => {
    const event = buildDocumentCreatedEvent({
      correlationId: 'corr-1',
      entityId: 'case-123',
      crn: '1234567890',
      sbi: '123456789'
    })

    expect(event.correlationid).toBe('corr-1')
    expect(event.audit.entities).toEqual([{ entity: 'document', action: 'created', entityid: 'case-123' }])
    expect(event.audit.accounts).toEqual({ crn: '1234567890', sbi: '123456789' })
    expect(event.audit.status).toBe('success')
    assertValid(event)
  })

  test('builds a valid document/created event with metadataId', () => {
    const event = buildDocumentCreatedEvent({
      correlationId: 'corr-2',
      entityId: 'metadata-456'
    })

    expect(event.audit.entities).toEqual([{ entity: 'document', action: 'created', entityid: 'metadata-456' }])
    expect(event.audit.accounts).toEqual({})
    assertValid(event)
  })

  test('carries details through unchanged', () => {
    const event = buildDocumentCreatedEvent({
      correlationId: 'corr-3',
      entityId: 'case-789',
      details: { fileId: 'file-1' }
    })

    expect(event.audit.details).toEqual({ fileId: 'file-1' })
    assertValid(event)
  })

  test('omits the correlationid key entirely when no correlationId is supplied, so the publisher default applies', () => {
    const event = buildDocumentCreatedEvent({
      entityId: 'case-999'
    })

    expect(event).not.toHaveProperty('correlationid')
    // Proves the publisher's own generateCorrelationId default can fill the
    // gap: if the key were present as `undefined`, this would fail schema
    // validation with "correlationid is required".
    assertValid(event)
  })
})

describe('buildPersonReadEvent', () => {
  test('builds a valid person/read success event with contactId', () => {
    const event = buildPersonReadEvent({
      correlationId: 'corr-4',
      contactId: 'contact-1',
      crn: '1234567890'
    })

    expect(event.audit.entities).toEqual([{ entity: 'person', action: 'read', entityid: 'contact-1' }])
    expect(event.audit.accounts).toEqual({ crn: '1234567890' })
    expect(event.audit.status).toBe('success')
    assertValid(event)
  })

  test('builds a valid person/read failure event with no entityid, per not-found rule', () => {
    const event = buildPersonReadEvent({
      correlationId: 'corr-5',
      crn: '1234567890',
      status: 'failure',
      details: { reason: 'CRN not found' }
    })

    expect(event.audit.entities).toEqual([{ entity: 'person', action: 'read', entityid: '' }])
    expect(event.audit.status).toBe('failure')
    expect(event.audit.details).toEqual({ reason: 'CRN not found' })
    assertValid(event)
  })
})

describe('buildBusinessReadEvent', () => {
  test('builds a valid business/read success event with accountId', () => {
    const event = buildBusinessReadEvent({
      correlationId: 'corr-6',
      accountId: 'account-1',
      sbi: '123456789'
    })

    expect(event.audit.entities).toEqual([{ entity: 'business', action: 'read', entityid: 'account-1' }])
    expect(event.audit.accounts).toEqual({ sbi: '123456789' })
    expect(event.audit.status).toBe('success')
    assertValid(event)
  })

  test('builds a valid business/read failure event with no entityid, per not-found rule', () => {
    const event = buildBusinessReadEvent({
      correlationId: 'corr-7',
      sbi: '123456789',
      status: 'failure',
      details: { reason: 'SBI not found' }
    })

    expect(event.audit.entities).toEqual([{ entity: 'business', action: 'read', entityid: '' }])
    expect(event.audit.status).toBe('failure')
    expect(event.audit.details).toEqual({ reason: 'SBI not found' })
    assertValid(event)
  })
})
