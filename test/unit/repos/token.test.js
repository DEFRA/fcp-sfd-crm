import { describe, test, expect, vi, beforeEach } from 'vitest'

const mockCollection = {
  updateOne: vi.fn(),
  findOne: vi.fn()
}

vi.mock('../../../src/data/db.js', () => ({
  default: {
    collection: () => mockCollection
  }
}))

vi.mock('../../../src/config/index.js', () => ({
  config: {
    get: vi.fn((key) => (key === 'auth.tokenId' ? 'test-token-id' : undefined))
  }
}))

const { setToken, getToken } = await import('../../../src/repos/token.js')

describe('token repository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('setToken', () => {
    test('should upsert token with value and expiry', async () => {
      mockCollection.updateOne.mockResolvedValue({ acknowledged: true })

      await setToken('Bearer test-token', 3600)

      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { _id: 'test-token-id' },
        expect.objectContaining({
          $set: expect.objectContaining({
            value: 'Bearer test-token',
            expiresAt: expect.any(Number),
            updatedAt: expect.any(Date)
          })
        }),
        { upsert: true }
      )
    })
  })

  describe('getToken', () => {
    test('should return null when token does not exist', async () => {
      mockCollection.findOne.mockResolvedValue(null)

      const result = await getToken()

      expect(result).toBeNull()
      expect(mockCollection.findOne).toHaveBeenCalledWith({ _id: 'test-token-id' })
    })

    test('should return null when token is expired', async () => {
      mockCollection.findOne.mockResolvedValue({
        value: 'Bearer expired',
        expiresAt: Date.now() - 1000
      })

      const result = await getToken()

      expect(result).toBeNull()
    })

    test('should return token value when valid', async () => {
      mockCollection.findOne.mockResolvedValue({
        value: 'Bearer valid-token',
        expiresAt: Date.now() + 3600000
      })

      const result = await getToken()

      expect(result).toBe('Bearer valid-token')
    })
  })
})
