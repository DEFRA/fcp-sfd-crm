import db from '../data/db.js'
import { createIndex } from '../data/create-index.js'

const COLLECTION = 'cases'

const setCorrelationIdIndex = async () => {
  await createIndex(db.collection(COLLECTION), { correlationId: 1 }, 'correlationId_1', true)
}

/**
 * Atomically upsert a case document and determine processing action.
 *
 * Uses findOneAndUpdate with returnDocument:'before' so:
 * - null result -> document was just inserted
 * - non-null    -> document already existed
 *
 * $setOnInsert sets initial fields only on insert; creatorFileId records
 * which fileId is responsible for creating the CRM case.
 *
 * @returns Promise<{{ isNew: boolean, isDuplicateFile: boolean, caseId: string|null, isCreator: boolean }}>
 */
const upsertCase = async (correlationId, fileId) => {
  // Attempt an atomic upsert and inspect the "before" document. This
  // supports both the real driver (which returns an object with a
  // `value` property) and unit tests that mock `findOneAndUpdate` to
  // return either `null` or a document directly.
  const result = await db.collection(COLLECTION).findOneAndUpdate(
    { correlationId },
    {
      $setOnInsert: {
        correlationId,
        caseId: null,
        creatorFileId: fileId,
        processedFileIds: [],
        createdAt: new Date()
      }
    },
    { upsert: true, returnDocument: 'before' }
  )

  // result may be null (mocked tests), an object with `value` (real driver),
  // or the document itself (some mocks). Normalize to `prevDoc`.
  let prevDoc = null

  if (result == null) {
    // Mocked unit test indicates insert
    return { isNew: true, isDuplicateFile: false, caseId: null, isCreator: true }
  }

  if (result.value !== undefined) {
    prevDoc = result.value
  } else {
    prevDoc = result
  }

  if (!prevDoc) {
    // This is unexpected in integration runs; log for debugging
    // eslint-disable-next-line no-console
    console.debug('upsertCase: previous document is null for', correlationId, 'result=', result)
    return { isNew: true, isDuplicateFile: false, caseId: null, isCreator: true }
  }

  const isDuplicateFile = prevDoc.processedFileIds?.includes(fileId) ?? false
  const isCreator = prevDoc.creatorFileId === fileId

  return { isNew: false, isDuplicateFile, caseId: prevDoc.caseId ?? null, isCreator }
}

/**
 * Record a fileId as successfully processed for the given correlationId.
 */
const markFileProcessed = async (correlationId, fileId) => {
  return db.collection(COLLECTION).updateOne(
    { correlationId },
    { $addToSet: { processedFileIds: fileId } }
  )
}

/**
 * Set the caseId on the document after successful CRM case creation.
 */
const updateCaseId = async (correlationId, caseId) => {
  return db.collection(COLLECTION).updateOne(
    { correlationId },
    { $set: { caseId } }
  )
}

export { setCorrelationIdIndex, upsertCase, markFileProcessed, updateCaseId }
