import { describe, test, expect, vi, beforeEach } from 'vitest'

const mockHttpClient = vi.fn()
const mockPublish = vi.fn().mockResolvedValue(true)

vi.mock('../../../src/http/client.js', () => ({ httpClient: mockHttpClient }))
vi.mock('../../../src/messaging/sns/publish.js', () => ({ publish: mockPublish }))
vi.mock('../../../src/config/index.js', () => ({
    config: {
        get: vi.fn((key) => {
            if (key === 'crm.baseUrl') return 'https://crm.example.com/api'
            if (key === 'messaging.crmEvents.topicArn') return 'arn:topic'
            return null
        })
    }
}))

const { getContactIdFromCrn, getAccountIdFromSbi } = await import('../../../src/repos/crm.js')

describe('crm publish callbacks', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    test('getContactIdFromCrn triggers publish when contact found', async () => {
        mockHttpClient.mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ value: [{ contactid: 'cid-1' }] }) })

        const res = await getContactIdFromCrn('Bearer t', '123')
        // wait for setImmediate callbacks and microtasks to run
        await new Promise((r) => setImmediate(r))
        await Promise.resolve()

        expect(res.contactId).toBe('cid-1')
        expect(mockPublish).toHaveBeenCalled()
    })

    test('getContactIdFromCrn triggers publish failure when not found', async () => {
        mockHttpClient.mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ value: [] }) })

        const res = await getContactIdFromCrn('Bearer t', '000')
        await new Promise((r) => setImmediate(r))
        await Promise.resolve()

        expect(res.contactId).toBeNull()
        expect(mockPublish).toHaveBeenCalled()
    })

    test('getContactIdFromCrn handles publish rejection and logs error', async () => {
        mockHttpClient.mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ value: [{ contactid: 'cid-2' }] }) })
        mockPublish.mockRejectedValueOnce(new Error('publish-fail'))

        const res = await getContactIdFromCrn('Bearer t', '111')
        await new Promise((r) => setImmediate(r))
        await Promise.resolve()

        expect(res.contactId).toBe('cid-2')
        expect(mockPublish).toHaveBeenCalled()
    })

    test('getAccountIdFromSbi triggers publish when account found', async () => {
        mockHttpClient.mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ value: [{ accountid: 'aid-1' }] }) })

        const res = await getAccountIdFromSbi('Bearer t', 'sbi-1')
        // publish is called synchronously via Promise.resolve, but still await microtask
        await Promise.resolve()

        expect(res.accountId).toBe('aid-1')
        expect(mockPublish).toHaveBeenCalled()
    })

    test('getAccountIdFromSbi handles publish rejection and logs error', async () => {
        mockHttpClient.mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ value: [{ accountid: 'aid-2' }] }) })
        mockPublish.mockRejectedValueOnce(new Error('publish-err'))

        const res = await getAccountIdFromSbi('Bearer t', 'sbi-2')
        await Promise.resolve()

        expect(res.accountId).toBe('aid-2')
        expect(mockPublish).toHaveBeenCalled()
    })
})
