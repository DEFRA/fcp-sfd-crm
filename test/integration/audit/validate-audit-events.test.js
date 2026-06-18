import { describe, test, expect } from 'vitest'
import { buildReceivedEvent } from '../../../src/messaging/outbound/received-event/build-received-event.js'
import { crmEvents } from '../../../src/constants/events.js'
import { validateAuditEvent } from '@defra/fcp-audit-publisher'

describe('Audit event validation', () => {
  test('validates person.read event (success)', async () => {
    const evt = buildReceivedEvent({ data: { contactId: 'c-1', accounts: { crn: '1234' }, correlationId: 'corr-1' } }, 'uk.gov.fcp.sfd.person.read')
    try {
      await validateAuditEvent(evt)
    } catch (e) {
      throw new Error('person.read validation failed: ' + e.message)
    }
  })

  test('validates business.read event (success)', async () => {
    const evt = buildReceivedEvent({ data: { accountId: 'a-1', accounts: { sbi: '987654321' }, correlationId: 'corr-2' } }, 'uk.gov.fcp.sfd.business.read')
    try {
      await validateAuditEvent(evt)
    } catch (e) {
      throw new Error('business.read validation failed: ' + e.message)
    }
  })

  test('validates document.created event (after case creation)', async () => {
    const evt = buildReceivedEvent({ data: { caseId: 'case-1', correlationId: 'corr-3' } }, crmEvents.DOCUMENT_CREATED)
    try {
      await validateAuditEvent(evt)
    } catch (e) {
      throw new Error('document.created validation failed: ' + e.message)
    }
  })

  test('validates security.auth event', async () => {
    const evt = buildReceivedEvent({ data: { security: { action: 'crm.token.request', status: 'failure', message: 'bad', clientId: 'c' }, audit: { status: 'failure', details: 'Invalid credentials' }, correlationId: 'corr-4' } }, 'uk.gov.fcp.sfd.security.auth')
    try {
      await validateAuditEvent(evt)
    } catch (e) {
      throw new Error('security.auth validation failed: ' + e.message)
    }
  })
})
