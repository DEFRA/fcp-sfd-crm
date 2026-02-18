import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { setCorrelationIdIndex as ensureIndex, upsertCase, markFileProcessed, updateCaseId } from '../../../../src/repos/cases.js'
import db from '../../../../src/data/db.js'

const COLLECTION = 'cases'

describe('Cases repository - Database integration', () => {
  beforeEach(async () => {
    await db.collection(COLLECTION).deleteMany({})
    await db.collection(COLLECTION).dropIndexes()
  })

  afterEach(async () => {
    await db.collection(COLLECTION).deleteMany({})
  })

  describe('ensureIndex', () => {
    test('should create a unique index on correlationId', async () => {
      await ensureIndex()

      const indexes = await db.collection(COLLECTION).indexes()
      const correlationIdIndex = indexes.find(idx => idx.key?.correlationId === 1)

      expect(correlationIdIndex).toBeDefined()
      expect(correlationIdIndex.unique).toBe(true)
    })
  })

  describe('upsertCase', () => {
    test('should insert a new document on first call for a correlationId', async () => {
      const result = await upsertCase('corr-1', 'file-1')

      expect(result.isNew).toBe(true)
      expect(result.isDuplicateFile).toBe(false)
      expect(result.caseId).toBeNull()
      expect(result.isCreator).toBe(true)

      const doc = await db.collection(COLLECTION).findOne({ correlationId: 'corr-1' })
      expect(doc).toBeDefined()
      expect(doc.correlationId).toBe('corr-1')
      expect(doc.caseId).toBeNull()
      expect(doc.creatorFileId).toBe('file-1')
      expect(doc.processedFileIds).toEqual([])
      expect(doc.createdAt).toBeInstanceOf(Date)
    })

    test('should return existing document for subsequent calls with different fileId', async () => {
      await upsertCase('corr-1', 'file-1')
      await markFileProcessed('corr-1', 'file-1')
      await updateCaseId('corr-1', 'case-1')

      const result = await upsertCase('corr-1', 'file-2')

      expect(result.isNew).toBe(false)
      expect(result.isDuplicateFile).toBe(false)
      expect(result.caseId).toBe('case-1')
      expect(result.isCreator).toBe(false)
    })

    test('should detect duplicate fileId', async () => {
      await upsertCase('corr-1', 'file-1')
      await markFileProcessed('corr-1', 'file-1')

      const result = await upsertCase('corr-1', 'file-1')

      expect(result.isNew).toBe(false)
      expect(result.isDuplicateFile).toBe(true)
    })

    test('should detect creator on retry when caseId is still null', async () => {
      await upsertCase('corr-1', 'file-1')

      const result = await upsertCase('corr-1', 'file-1')

      expect(result.isNew).toBe(false)
      expect(result.isDuplicateFile).toBe(false)
      expect(result.caseId).toBeNull()
      expect(result.isCreator).toBe(true)
    })

    test('concurrent upserts with same correlationId should both succeed without error', async () => {
      await ensureIndex()

      const results = await Promise.allSettled([
        upsertCase('corr-race', 'file-a'),
        upsertCase('corr-race', 'file-b')
      ])

      const fulfilled = results.filter(r => r.status === 'fulfilled')
      expect(fulfilled).toHaveLength(2)

      const count = await db.collection(COLLECTION).countDocuments({ correlationId: 'corr-race' })
      expect(count).toBe(1)
    })
  })

  describe('markFileProcessed', () => {
    test('should add fileId to processedFileIds array', async () => {
      await upsertCase('corr-1', 'file-1')
      await markFileProcessed('corr-1', 'file-1')

      const doc = await db.collection(COLLECTION).findOne({ correlationId: 'corr-1' })
      expect(doc.processedFileIds).toContain('file-1')
    })

    test('should not duplicate fileId with $addToSet', async () => {
      await upsertCase('corr-1', 'file-1')
      await markFileProcessed('corr-1', 'file-1')
      await markFileProcessed('corr-1', 'file-1')

      const doc = await db.collection(COLLECTION).findOne({ correlationId: 'corr-1' })
      expect(doc.processedFileIds.filter(id => id === 'file-1')).toHaveLength(1)
    })
  })

  describe('updateCaseId', () => {
    test('should set caseId on the document', async () => {
      await upsertCase('corr-1', 'file-1')
      await updateCaseId('corr-1', 'case-1')

      const doc = await db.collection(COLLECTION).findOne({ correlationId: 'corr-1' })
      expect(doc.caseId).toBe('case-1')
    })
  })
})
