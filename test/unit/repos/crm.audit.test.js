import { vi, describe, beforeEach, test, expect } from 'vitest'

vi.mock('../../../src/messaging/sns/client.js', () => ({ snsClient: { send: vi.fn().mockResolvedValue({ MessageId: 'mock-message-id' }) } }))
vi.mock('../../../src/messaging/sns/publish.js', () => ({ publish: vi.fn().mockResolvedValue(true) }))
vi.mock('../../../src/messaging/outbound/audit/send-audit-event.js', () => ({ sendAuditEvent: vi.fn().mockResolvedValue(true) }))
vi.mock('../../../src/http/client.js', () => ({ httpClient: vi.fn() }))
vi.mock('../../../src/logging/logger.js', () => ({ createLogger: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))

const { getContactIdFromCrn, getAccountIdFromSbi } = await import('../../../src/repos/crm.js')
const { publish } = await import('../../../src/messaging/sns/publish.js')
const { sendAuditEvent } = await import('../../../src/messaging/outbound/audit/send-audit-event.js')
const { httpClient } = await import('../../../src/http/client.js')

describe('CRM repo audit emissions', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    test('getContactIdFromCrn emits person.read and audit on success', async () => {
        const response = { json: async () => ({ value: [{ contactid: 'contact-1' }] }) }
        httpClient.mockResolvedValue(response)

        const result = await getContactIdFromCrn('token', 'CRN1', { correlationId: 'corr-1' })
        // wait for setImmediate background publishers/audits
        await new Promise(r => setImmediate(r))

        expect(result.contactId).toBe('contact-1')
        expect(publish).toHaveBeenCalled()
        expect(sendAuditEvent).toHaveBeenCalled()
    })

    test('getContactIdFromCrn emits person.read failure audit and swallows audit errors', async () => {
        const response = { json: async () => ({ value: [] }) }
        httpClient.mockResolvedValue(response)

        sendAuditEvent.mockRejectedValueOnce(new Error('audit failed'))

        const result = await getContactIdFromCrn('token', 'CRN2', { correlationId: 'corr-2' })
        await new Promise(r => setImmediate(r))

        expect(result.contactId).toBeNull()
        expect(publish).toHaveBeenCalled()
        expect(sendAuditEvent).toHaveBeenCalled()
    })

    test('getAccountIdFromSbi emits business.read and audit on success', async () => {
        const response = { json: async () => ({ value: [{ accountid: 'account-1' }] }) }
        httpClient.mockResolvedValue(response)

        const result = await getAccountIdFromSbi('token', 'SBI1', { correlationId: 'corr-3' })
        await new Promise(r => setImmediate(r))

        expect(result.accountId).toBe('account-1')
        expect(publish).toHaveBeenCalled()
        expect(sendAuditEvent).toHaveBeenCalled()
    })

    test('getAccountIdFromSbi emits business.read failure audit and swallows audit errors', async () => {
        const response = { json: async () => ({ value: [] }) }
        httpClient.mockResolvedValue(response)

        sendAuditEvent.mockRejectedValueOnce(new Error('audit failed'))

        const result = await getAccountIdFromSbi('token', 'SBI2', { correlationId: 'corr-4' })
        await new Promise(r => setImmediate(r))

        expect(result.accountId).toBeNull()
        expect(publish).toHaveBeenCalled()
        expect(sendAuditEvent).toHaveBeenCalled()
    })
})
