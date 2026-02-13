import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { ensureIndex, findByCorrelationId, create } from '../../../../src/repos/cases.js'
import db from '../../../../src/data/db.js'
import { MONGO_DUPLICATE_KEY_ERROR_CODE } from '../../../../src/constants/mongodb.js'

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

  describe('create', () => {
    test('should insert a case record with correlationId, caseId, and createdAt', async () => {
      await create({ correlationId: 'corr-1', caseId: 'case-1' })

      const record = await db.collection(COLLECTION).findOne({ correlationId: 'corr-1' })

      expect(record).toBeDefined()
      expect(record.correlationId).toBe('corr-1')
      expect(record.caseId).toBe('case-1')
      expect(record.createdAt).toBeInstanceOf(Date)
    })

    test('should reject duplicate correlationId when unique index exists', async () => {
      await ensureIndex()

      await create({ correlationId: 'corr-dup', caseId: 'case-1' })

      const duplicateInsert = create({ correlationId: 'corr-dup', caseId: 'case-2' })

      await expect(duplicateInsert).rejects.toMatchObject({ code: MONGO_DUPLICATE_KEY_ERROR_CODE })
    })

    test('concurrent inserts with same correlationId should result in only one record', async () => {
      await ensureIndex()

      const results = await Promise.allSettled([
        create({ correlationId: 'corr-race', caseId: 'case-a' }),
        create({ correlationId: 'corr-race', caseId: 'case-b' })
      ])

      const fulfilled = results.filter(r => r.status === 'fulfilled')
      const rejected = results.filter(r => r.status === 'rejected')

      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      expect(rejected[0].reason.code).toBe(MONGO_DUPLICATE_KEY_ERROR_CODE)

      const count = await db.collection(COLLECTION).countDocuments({ correlationId: 'corr-race' })
      expect(count).toBe(1)
    })
  })

  describe('findByCorrelationId', () => {
    test('should return the case record when it exists', async () => {
      await create({ correlationId: 'corr-find', caseId: 'case-find' })

      const result = await findByCorrelationId('corr-find')

      expect(result).toBeDefined()
      expect(result.correlationId).toBe('corr-find')
      expect(result.caseId).toBe('case-find')
      expect(result.createdAt).toBeInstanceOf(Date)
    })

    test('should return null when no case exists for the correlationId', async () => {
      const result = await findByCorrelationId('non-existent')

      expect(result).toBeNull()
    })
  })
})
