import { describe, test, expect, vi, beforeEach } from 'vitest'

const mockLogger = { error: vi.fn(), info: vi.fn() }

vi.mock('../../../src/logging/logger.js', () => ({
    createLogger: () => mockLogger
}))

vi.mock('../../../src/services/caseService.js', () => ({
    createCase: vi.fn()
}))

const { handleMessage } = await import('../../../src/messaging/inbound/messageHandler.js')
const { createCase } = await import('../../../src/services/caseService.js')

describe('handleMessage', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    test('calls createCase with valid payload', async () => {
        const message = {
            Body: JSON.stringify({
                caseId: '123',
                subject: 'Test case',
                details: { foo: 'bar' }
            })
        }

        createCase.mockResolvedValue({ caseId: '123' })

        await handleMessage(message)

        expect(createCase).toHaveBeenCalledWith({
            caseId: '123',
            subject: 'Test case',
            details: { foo: 'bar' }
        })
        expect(mockLogger.error).not.toHaveBeenCalled()
    })

    test('logs error and continues for invalid JSON', async () => {
        const badMessage = { Body: 'not-json' }

        await handleMessage(badMessage)

        expect(mockLogger.error).toHaveBeenCalledWith(
            'Invalid JSON in inbound message',
            expect.any(SyntaxError)
        )
        expect(createCase).not.toHaveBeenCalled()
    })

    test('logs error if createCase throws but does not throw itself', async () => {
        const message = {
            Body: JSON.stringify({
                caseId: '123',
                subject: 'Test case',
                details: {}
            })
        }

        const error = new Error('CRM failure')
        createCase.mockRejectedValue(error)

        await handleMessage(message)

        expect(createCase).toHaveBeenCalled()
        expect(mockLogger.error).toHaveBeenCalledWith(
            'Failed to create case via CRM API',
            error
        )
    })
})
