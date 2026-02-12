import { describe, test, expect, vi, beforeEach } from 'vitest'

const mockCollection = {
  createIndex: vi.fn(),
  findOne: vi.fn(),
  insertOne: vi.fn()
}

vi.mock('../../../src/data/db.js', () => ({
  default: {
    collection: vi.fn(() => mockCollection)
  }
}))

vi.mock('../../../src/logging/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn() })
}))

const { ensureIndex, findByCorrelationId, create } = await import('../../../src/repos/cases.js')
const { MONGO_DUPLICATE_KEY_ERROR_CODE } = await import('../../../src/constants/mongodb.js')

describe('cases repository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('ensureIndex', () => {
    test('should create a unique index on correlationId', async () => {
      await ensureIndex()

      expect(mockCollection.createIndex).toHaveBeenCalledWith(
        { correlationId: 1 },
        { unique: true }
      )
    })
  })

  describe('findByCorrelationId', () => {
    test('should query the cases collection by correlationId', async () => {
      const mockCase = { correlationId: 'corr-1', caseId: 'case-1', createdAt: new Date() }
      mockCollection.findOne.mockResolvedValue(mockCase)

      const result = await findByCorrelationId('corr-1')

      expect(mockCollection.findOne).toHaveBeenCalledWith({ correlationId: 'corr-1' })
      expect(result).toEqual(mockCase)
    })

    test('should return null when no case exists', async () => {
      mockCollection.findOne.mockResolvedValue(null)

      const result = await findByCorrelationId('non-existent')

      expect(mockCollection.findOne).toHaveBeenCalledWith({ correlationId: 'non-existent' })
      expect(result).toBeNull()
    })
  })

  describe('create', () => {
    test('should insert a document with correlationId, caseId, and createdAt', async () => {
      mockCollection.insertOne.mockResolvedValue({ acknowledged: true })

      await create({ correlationId: 'corr-1', caseId: 'case-1' })

      expect(mockCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: 'corr-1',
          caseId: 'case-1',
          createdAt: expect.any(Date)
        })
      )
    })

    test('should propagate errors from insertOne', async () => {
      const duplicateError = new Error('E11000 duplicate key error')
      duplicateError.code = MONGO_DUPLICATE_KEY_ERROR_CODE
      mockCollection.insertOne.mockRejectedValue(duplicateError)

      await expect(create({ correlationId: 'corr-1', caseId: 'case-1' }))
        .rejects.toThrow('E11000 duplicate key error')
    })
  })
})
