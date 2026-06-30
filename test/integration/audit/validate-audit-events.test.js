import { describe, test, expect } from 'vitest'
import { validateAuditEvent } from '@defra/fcp-audit-publisher'

const buildBasePayload = (correlationid) => ({
  correlationid,
  datetime: new Date().toISOString(),
  environment: 'local',
  version: '1.0.0',
  application: 'fcp-sfd-crm',
  component: 'fcp-sfd-crm',
  ip: '0.0.0.0'
})

describe('Audit event validation', () => {
  test('validates person.read event (success)', () => {
    const evt = {
      ...buildBasePayload('corr-1'),
      audit: {
        entities: [{ entity: 'person', action: 'read', entityid: 'c-1' }],
        accounts: { crn: '1234' }
      }
    }

    expect(validateAuditEvent(evt).valid).toBe(true)
  })

  test('validates business.read event (success)', () => {
    const evt = {
      ...buildBasePayload('corr-2'),
      audit: {
        entities: [{ entity: 'business', action: 'read', entityid: 'a-1' }],
        accounts: { sbi: '987654321' }
      }
    }

    expect(validateAuditEvent(evt).valid).toBe(true)
  })

  test('validates document.created event (after case creation)', () => {
    const evt = {
      ...buildBasePayload('corr-3'),
      audit: {
        entities: [{ entity: 'document', action: 'created', entityid: 'case-1' }],
        accounts: {}
      }
    }

    expect(validateAuditEvent(evt).valid).toBe(true)
  })

  test('validates security.auth event', () => {
    const evt = {
      ...buildBasePayload('corr-4'),
      security: {
        pmccode: 'AUTH',
        details: {
          transactioncode: 'TOKN',
          message: 'Invalid credentials'
        }
      }
    }

    expect(validateAuditEvent(evt).valid).toBe(true)
  })
})
