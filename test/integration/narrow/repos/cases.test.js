import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import {
  setCorrelationIdIndex as ensureIndex,
  upsertCase,
  markFileProcessed,
  updateCaseId,
  claimCreatorRole,
  releaseCreator
} from '../../../../src/repos/cases.js'
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

  describe('claimCreatorRole', () => {
    const expireDeadline = async (correlationId) => {
      await db.collection(COLLECTION).updateOne(
        { correlationId },
        { $set: { creationDeadline: new Date(Date.now() - 1000) } }
      )
    }

    test('should refuse a claim while the creator has a live deadline', async () => {
      await upsertCase('corr-1', 'file-1')

      const claimed = await claimCreatorRole('corr-1', 'file-2')

      expect(claimed).toBe(false)

      const doc = await db.collection(COLLECTION).findOne({ correlationId: 'corr-1' })
      expect(doc.creatorFileId).toBe('file-1')
    })

    test('should allow a claim once the deadline has passed', async () => {
      await upsertCase('corr-1', 'file-1')
      await expireDeadline('corr-1')

      const claimed = await claimCreatorRole('corr-1', 'file-2')

      expect(claimed).toBe(true)

      const doc = await db.collection(COLLECTION).findOne({ correlationId: 'corr-1' })
      expect(doc.creatorFileId).toBe('file-2')
      expect(doc.creationDeadline.getTime()).toBeGreaterThan(Date.now())
    })

    test('should refuse a claim once a case has already been created', async () => {
      await upsertCase('corr-1', 'file-1')
      await updateCaseId('corr-1', 'case-1')
      await expireDeadline('corr-1')

      const claimed = await claimCreatorRole('corr-1', 'file-2')

      expect(claimed).toBe(false)
    })

    test('should refuse a claim for a correlationId that does not exist', async () => {
      const claimed = await claimCreatorRole('corr-missing', 'file-2')

      expect(claimed).toBe(false)
    })

    test('should allow a claim on a document predating creationDeadline, which has no such field', async () => {
      // Shaped as upsertCase wrote documents before creationDeadline existed.
      await db.collection(COLLECTION).insertOne({
        correlationId: 'corr-legacy',
        caseId: null,
        creatorFileId: 'file-1',
        processedFileIds: [],
        createdAt: new Date()
      })

      const claimed = await claimCreatorRole('corr-legacy', 'file-2')

      expect(claimed).toBe(true)

      const doc = await db.collection(COLLECTION).findOne({ correlationId: 'corr-legacy' })
      expect(doc.creatorFileId).toBe('file-2')
      expect(doc.creationDeadline).toBeInstanceOf(Date)
    })

    test('should allow exactly one of several concurrent claimants to win', async () => {
      await upsertCase('corr-race', 'file-1')
      await expireDeadline('corr-race')

      const results = await Promise.all([
        claimCreatorRole('corr-race', 'file-2'),
        claimCreatorRole('corr-race', 'file-3'),
        claimCreatorRole('corr-race', 'file-4')
      ])

      expect(results.filter(Boolean)).toHaveLength(1)
    })

    test('should refuse a second claimant immediately after a successful takeover, since the new deadline is extended', async () => {
      await upsertCase('corr-1', 'file-1')
      await expireDeadline('corr-1')

      const firstClaim = await claimCreatorRole('corr-1', 'file-2')
      expect(firstClaim).toBe(true)

      const secondClaim = await claimCreatorRole('corr-1', 'file-3')
      expect(secondClaim).toBe(false)

      const doc = await db.collection(COLLECTION).findOne({ correlationId: 'corr-1' })
      expect(doc.creatorFileId).toBe('file-2')
    })
  })

  describe('releaseCreator', () => {
    test('should clear creatorFileId so another file can claim it', async () => {
      await upsertCase('corr-1', 'file-1')

      const released = await releaseCreator('corr-1', 'file-1')
      expect(released).toBe(true)

      const claimed = await claimCreatorRole('corr-1', 'file-2')
      expect(claimed).toBe(true)
    })

    test('should not release a different fileId than the current creator', async () => {
      await upsertCase('corr-1', 'file-1')

      const released = await releaseCreator('corr-1', 'file-2')

      expect(released).toBe(false)

      const doc = await db.collection(COLLECTION).findOne({ correlationId: 'corr-1' })
      expect(doc.creatorFileId).toBe('file-1')
    })

    test('should not release once a case has already been created', async () => {
      await upsertCase('corr-1', 'file-1')
      await updateCaseId('corr-1', 'case-1')

      const released = await releaseCreator('corr-1', 'file-1')

      expect(released).toBe(false)
    })
  })
})
