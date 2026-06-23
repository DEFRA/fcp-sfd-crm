import { vi, describe, beforeEach, test, expect } from 'vitest'

// Record payloads received by a real-like publishAuditEvent (no .mock prop)
const recorded = []
vi.mock('@defra/fcp-audit-publisher', () => ({
    publishAuditEvent: async (payload, cfg) => {
        recorded.push({ payload, cfg })
        return { messageId: 'real-mock-id' }
    }
}))

vi.mock('../../../../../src/messaging/sns/client.js', () => ({
    snsClient: { send: vi.fn().mockResolvedValue({ MessageId: 'mock-message-id' }) }
}))

vi.mock('../../../../../src/logging/logger.js', () => ({
    createLogger: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}))

vi.mock('../../../../../src/config/index.js', () => ({
    config: { get: vi.fn(() => undefined) }
}))

describe('sendAuditEvent (real publisher path)', () => {
    beforeEach(() => {
        recorded.length = 0
        vi.clearAllMocks()
    })

    test('maps CloudEvent person.read to audit.person payload', async () => {
        const { sendAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')
        const auditMod = await import('@defra/fcp-audit-publisher')
        // ensure we run the non-mock publisher path
        delete auditMod.publishAuditEvent.mock

        const ce = {
            id: '1',
            specversion: '1.0',
            source: 'test',
            type: 'person.read',
            data: { contactId: 'cid-1', accounts: { crn: '123' }, correlationId: 'corr-1' }
        }

        await sendAuditEvent(ce)

        expect(recorded.length).toBe(1)
        const { payload } = recorded[0]
        expect(payload.audit).toBeDefined()
        expect(payload.audit.entities).toEqual([
            { entity: 'person', action: 'read', entityid: 'cid-1' }
        ])
        expect(payload.audit.accounts).toEqual({ crn: '123' })
        expect(payload.correlationid).toBe('corr-1')
    })

    test('sends security payload and coerces non-object details', async () => {
        const { sendAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

        const event = { security: { user: 'u', details: 'failed' }, correlationId: 'corr-2' }

        await sendAuditEvent(event)

        expect(recorded.length).toBe(1)
        const { payload } = recorded[0]
        expect(payload.security).toBeDefined()
        expect(payload.security.details).toEqual({ message: 'failed' })
        expect(payload.correlationid).toBe('corr-2')
    })

    test('coerces audit.details string to object and ensures fallback entity', async () => {
        const { sendAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

        const auditMod = await import('@defra/fcp-audit-publisher')
        // ensure we run the non-mock publisher path
        delete auditMod.publishAuditEvent.mock

        const event = { data: { audit: { details: 'plain message' } } }
        await sendAuditEvent(event)

        expect(recorded.length).toBe(1)
        const { payload } = recorded[0]
        expect(payload.audit.details).toEqual({ message: 'plain message' })
        expect(payload.audit.entities[0].entity).toBe('service')
    })

    test('maps accountId to business entity', async () => {
        const { sendAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

        const event = {
            data: { accountId: 'acc-1', accounts: { sbi: '999' }, correlationId: 'corr-3' }
        }
        await sendAuditEvent(event)

        expect(recorded.length).toBe(1)
        const { payload } = recorded[0]
        expect(payload.audit.entities).toEqual([
            { entity: 'business', action: 'read', entityid: 'acc-1' }
        ])
        expect(payload.audit.accounts).toEqual({ sbi: '999' })
    })

    test('maps caseId and metadataId to document/case entities', async () => {
        const { sendAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

        const event = {
            data: { caseId: 'case-99', metadataId: 'meta-99', correlationId: 'corr-4' }
        }
        await sendAuditEvent(event)

        expect(recorded.length).toBe(1)
        const { payload } = recorded[0]
        const entityTypes = payload.audit.entities.map(e => e.entity)
        expect(entityTypes).toContain('case')
        expect(entityTypes).toContain('document')
    })

    test('copies audit.status and audit.details from input data', async () => {
        const { sendAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

        const event = {
            data: {
                audit: { status: 'failure', details: { reason: 'CRN not found' } }
            }
        }
        await sendAuditEvent(event)

        expect(recorded.length).toBe(1)
        const { payload } = recorded[0]
        expect(payload.audit.status).toBe('failure')
        expect(payload.audit.details).toEqual({ reason: 'CRN not found' })
    })

    test('security payload includes correlationid when provided', async () => {
        const { sendAuditEvent } = await import('../../../../../src/messaging/outbound/audit/send-audit-event.js')

        const event = {
            data: { security: { user: 'admin', details: { action: 'login' } }, correlationId: 'corr-sec-1' }
        }
        await sendAuditEvent(event)

        expect(recorded.length).toBe(1)
        const { payload } = recorded[0]
        expect(payload.security).toBeDefined()
        expect(payload.correlationid).toBe('corr-sec-1')
    })
})
