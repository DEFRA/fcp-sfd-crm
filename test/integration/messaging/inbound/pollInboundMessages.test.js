import { describe, test, expect, vi, beforeEach } from 'vitest'

const mockLogger = { info: vi.fn(), error: vi.fn() }

// Mock logger
vi.mock('../../../../src/logging/logger.js', () => ({
    createLogger: () => mockLogger
}))

// Mock caseService
const mockCreateCase = vi.fn()
vi.mock('../../../../src/services/caseService.js', () => ({
    createCase: mockCreateCase
}))

// Mock AWS SDK SQS
const mockDeleteMessage = vi.fn().mockResolvedValue({})
const mockReceiveMessage = vi.fn()
vi.mock('aws-sdk', () => {
    return {
        SQS: class {
            receiveMessage = mockReceiveMessage
            deleteMessage = mockDeleteMessage
        },
        config: { update: vi.fn() }
    }
})

const { pollInboundMessages } = await import('../../../../src/messaging/inbound/index.js')

describe('pollInboundMessages', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    test('processes messages successfully and deletes them', async () => {
        mockReceiveMessage.mockReturnValueOnce({
            promise: () => Promise.resolve({
                Messages: [
                    { Body: JSON.stringify({ caseId: '1', subject: 'A', details: {} }), ReceiptHandle: 'rh-1' },
                    { Body: JSON.stringify({ caseId: '2', subject: 'B', details: {} }), ReceiptHandle: 'rh-2' }
                ]
            })
        })

        // Run pollInboundMessages once using no-op delay
        await pollInboundMessages(() => { })

        // Assert createCase called with each message payload
        expect(mockCreateCase).toHaveBeenCalledTimes(2)
        expect(mockCreateCase).toHaveBeenCalledWith({ caseId: '1', subject: 'A', details: {} })
        expect(mockCreateCase).toHaveBeenCalledWith({ caseId: '2', subject: 'B', details: {} })

        // Assert messages deleted from SQS
        expect(mockDeleteMessage).toHaveBeenCalledTimes(2)
        expect(mockDeleteMessage).toHaveBeenCalledWith(expect.objectContaining({ ReceiptHandle: 'rh-1' }))
        expect(mockDeleteMessage).toHaveBeenCalledWith(expect.objectContaining({ ReceiptHandle: 'rh-2' }))
    })

    test('logs errors on invalid JSON but continues processing', async () => {
        mockReceiveMessage.mockReturnValueOnce({
            promise: () => Promise.resolve({
                Messages: [
                    { Body: 'invalid-json', ReceiptHandle: 'rh-1' },
                    { Body: JSON.stringify({ caseId: '3', subject: 'C', details: {} }), ReceiptHandle: 'rh-2' }
                ]
            })
        })

        await pollInboundMessages(() => { })

        // Only one valid message triggers createCase
        expect(mockCreateCase).toHaveBeenCalledTimes(1)
        expect(mockCreateCase).toHaveBeenCalledWith({ caseId: '3', subject: 'C', details: {} })

        // Error logged for invalid JSON
        expect(mockLogger.error).toHaveBeenCalledWith(
            'Invalid JSON in inbound message',
            expect.any(SyntaxError)
        )

        // Both messages attempted to be deleted
        expect(mockDeleteMessage).toHaveBeenCalledTimes(2)
    })

    test('logs errors from createCase but continues processing', async () => {
        mockReceiveMessage.mockReturnValueOnce({
            promise: () => Promise.resolve({
                Messages: [
                    { Body: JSON.stringify({ caseId: '4', subject: 'D', details: {} }), ReceiptHandle: 'rh-4' }
                ]
            })
        })

        const error = new Error('CRM API failed')
        mockCreateCase.mockRejectedValue(error)

        await pollInboundMessages(() => { })

        expect(mockCreateCase).toHaveBeenCalledTimes(1)
        expect(mockLogger.error).toHaveBeenCalledWith('Inbound message handling failed', error)
        expect(mockDeleteMessage).toHaveBeenCalledTimes(1)
    })
})
