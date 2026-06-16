import { describe, test, expect, vi } from 'vitest'

// Mock config and http client
const mockHttpClient = vi.fn()
vi.mock('../../../src/config/index.js', () => ({
    config: { get: vi.fn((k) => (k === 'crm.baseUrl' ? 'https://crm.example.com/api' : 'arn:topic')) }
}))
vi.mock('../../../src/http/client.js', () => ({ httpClient: mockHttpClient }))

// Mock publish to a resolved promise
vi.mock('../../../src/messaging/sns/publish.js', () => ({ publish: vi.fn().mockResolvedValue(true) }))

// Mock buildReceivedEvent to throw to trigger outer catch handlers
vi.mock('../../../src/messaging/outbound/received-event/build-received-event.js', () => ({ buildReceivedEvent: () => { throw new Error('build-fail') } }))

const { getContactIdFromCrn, getAccountIdFromSbi } = await import('../../../src/repos/crm.js')

describe('crm buildReceivedEvent errors', () => {
    test('getContactIdFromCrn handles buildReceivedEvent throwing (contact path)', async () => {
        mockHttpClient.mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ value: [{ contactid: 'cid-9' }] }) })

        const res = await getContactIdFromCrn('Bearer t', '999')
        // allow async logger import to run
        await new Promise((r) => setImmediate(r))

        expect(res.contactId).toBe('cid-9')
    })

    test('getContactIdFromCrn handles buildReceivedEvent throwing (not found path)', async () => {
        mockHttpClient.mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ value: [] }) })

        const res = await getContactIdFromCrn('Bearer t', '000')
        await new Promise((r) => setImmediate(r))

        expect(res.contactId).toBeNull()
    })

    test('getAccountIdFromSbi handles buildReceivedEvent throwing', async () => {
        mockHttpClient.mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ value: [{ accountid: 'aid-9' }] }) })

        const res = await getAccountIdFromSbi('Bearer t', 'sbi-9')
        await Promise.resolve()

        expect(res.accountId).toBe('aid-9')
    })
})
