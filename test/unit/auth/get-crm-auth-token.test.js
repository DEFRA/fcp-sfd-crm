import { describe, it, expect, vi, beforeEach } from 'vitest'

// Thing under test
import { getCrmAuthToken } from '../../src/auth/get-crm-auth-token.js'

// Mock dependencies
import Wreck from '@hapi/wreck'
import { config } from '../../../../../src/config/index.js'

// Mock all imports

vi.mock('@hapi/wreck', () => ({
    default: {
        post: vi.fn()
    }
}))

vi.mock('../../../../../src/config/index.js', () => ({
    config: {
        get: vi.fn()
    }
}))

describe('getTokenService', () => {
    const mockCache = {}

    beforeEach(() => {
        vi.clearAllMocks()
        config.get.mockReturnValue({
            clientId: 'fake-client',
            clientSecret: 'fake-secret',
            tokenEndpoint: 'https://dal.test/token'
        })
    })

    it('returns cached token if available', async () => {
        // Set the fake token to return when 'get' is called
        const fakeToken = 'Bearer cached-token'
        get.mockResolvedValueOnce(fakeToken)

        // Retry should just call our function once
        retry.mockImplementation(fn => fn())

        const result = await getTokenService(mockCache)

        expect(get).toHaveBeenCalledWith('dal-token', mockCache)
        expect(result).toBe(fakeToken)
        expect(Wreck.post).not.toHaveBeenCalled()
        expect(set).not.toHaveBeenCalled()
    })

    it('fetches a new token and caches it if no cached token exists', async () => {
        get.mockResolvedValueOnce(null) // simulate cache miss

        const fakeResponse = {
            payload: {
                token_type: 'Bearer',
                access_token: 'new-access-token',
                expires_in: 354 // seconds
            }
        }
        Wreck.post.mockResolvedValueOnce(fakeResponse)

        retry.mockImplementation(fn => fn())

        const result = await getTokenService(mockCache)

        expect(Wreck.post).toHaveBeenCalledWith('https://dal.test/token', {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            payload: expect.stringContaining('client_id=fake-client'),
            json: true
        })

        expect(set).toHaveBeenCalledWith(
            'dal-token',
            'Bearer new-access-token',
            (fakeResponse.payload.expires_in * 1000) - 60000,
            mockCache
        )

        expect(result).toBe('Bearer new-access-token')
    })

    it('returns an error when the token request cannot be completed', async () => {
        get.mockResolvedValueOnce(null) // no cache

        Wreck.post.mockRejectedValueOnce(new Error('dal error'))
        retry.mockImplementation(fn => fn())

        await expect(getTokenService(mockCache)).rejects.toThrow('dal error')
    })
})
