import db from '../data/db.js'

const COLLECTION = 'cases'

const ensureIndex = async () => {
  await db.collection(COLLECTION).createIndex(
    { correlationId: 1 },
    { unique: true }
  )
}

const findByCorrelationId = async (correlationId) => {
  return db.collection(COLLECTION).findOne({ correlationId })
}

const create = async ({ correlationId, caseId }) => {
  const doc = {
    correlationId,
    caseId,
    createdAt: new Date()
  }
  return db.collection(COLLECTION).insertOne(doc)
}

export { ensureIndex, findByCorrelationId, create }
