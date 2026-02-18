import { describe, test, expect, vi, beforeEach } from 'vitest'

const mockCollection = {
  createIndex: vi.fn(),
  findOneAndUpdate: vi.fn(),
  updateOne: vi.fn()
}

vi.mock('../../../src/data/db.js', () => ({
  default: {
    collection: vi.fn(() => mockCollection)
  }
}))

vi.mock('../../../src/logging/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn() })
}))

const { setCorrelationIdIndex: ensureIndex, upsertCase, markFileProcessed, updateCaseId } = await import('../../../src/repos/cases.js')

describe('cases repository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('ensureIndex', () => {
    test('should create a unique index on correlationId', async () => {
      await ensureIndex()

      expect(mockCollection.createIndex).toHaveBeenCalledWith(
        { correlationId: 1 },
        { unique: true, name: 'correlationId_1' }
      )
    })
  })

  describe('upsertCase', () => {
    test('should return isNew:true when document was inserted (null result)', async () => {
      mockCollection.findOneAndUpdate.mockResolvedValue(null)

      const result = await upsertCase('corr-1', 'file-1')

      expect(result).toEqual({ isNew: true, isDuplicateFile: false, caseId: null, isCreator: true })
      expect(mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
        { correlationId: 'corr-1' },
        {
          $setOnInsert: {
            correlationId: 'corr-1',
            caseId: null,
            creatorFileId: 'file-1',
            processedFileIds: [],
            createdAt: expect.any(Date)
          }
        },
        { upsert: true, returnDocument: 'before' }
      )
    })

    test('should return isDuplicateFile:true when fileId already in processedFileIds', async () => {
      mockCollection.findOneAndUpdate.mockResolvedValue({
        correlationId: 'corr-1',
        caseId: 'case-1',
        creatorFileId: 'file-1',
        processedFileIds: ['file-1']
      })

      const result = await upsertCase('corr-1', 'file-1')

      expect(result).toEqual({ isNew: false, isDuplicateFile: true, caseId: 'case-1', isCreator: true })
    })

    test('should return isDuplicateFile:false for a new fileId on existing case', async () => {
      mockCollection.findOneAndUpdate.mockResolvedValue({
        correlationId: 'corr-1',
        caseId: 'case-1',
        creatorFileId: 'file-1',
        processedFileIds: ['file-1']
      })

      const result = await upsertCase('corr-1', 'file-2')

      expect(result).toEqual({ isNew: false, isDuplicateFile: false, caseId: 'case-1', isCreator: false })
    })

    test('should return isCreator:true when fileId matches creatorFileId', async () => {
      mockCollection.findOneAndUpdate.mockResolvedValue({
        correlationId: 'corr-1',
        caseId: null,
        creatorFileId: 'file-1',
        processedFileIds: []
      })

      const result = await upsertCase('corr-1', 'file-1')

      expect(result).toEqual({ isNew: false, isDuplicateFile: false, caseId: null, isCreator: true })
    })

    test('should return isCreator:false when fileId does not match creatorFileId', async () => {
      mockCollection.findOneAndUpdate.mockResolvedValue({
        correlationId: 'corr-1',
        caseId: null,
        creatorFileId: 'file-1',
        processedFileIds: []
      })

      const result = await upsertCase('corr-1', 'file-2')

      expect(result).toEqual({ isNew: false, isDuplicateFile: false, caseId: null, isCreator: false })
    })

    test('should handle missing processedFileIds gracefully', async () => {
      mockCollection.findOneAndUpdate.mockResolvedValue({
        correlationId: 'corr-1',
        caseId: 'case-1',
        creatorFileId: 'file-1'
      })

      const result = await upsertCase('corr-1', 'file-1')

      expect(result.isDuplicateFile).toBe(false)
    })
  })

  describe('markFileProcessed', () => {
    test('should $addToSet the fileId into processedFileIds', async () => {
      mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 })

      await markFileProcessed('corr-1', 'file-1')

      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { correlationId: 'corr-1' },
        { $addToSet: { processedFileIds: 'file-1' } }
      )
    })
  })

  describe('updateCaseId', () => {
    test('should $set the caseId on the document', async () => {
      mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 })

      await updateCaseId('corr-1', 'case-1')

      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { correlationId: 'corr-1' },
        { $set: { caseId: 'case-1' } }
      )
    })
  })
})
