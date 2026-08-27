import db from '../data/db.js'
import { createIndex } from '../data/create-index.js'
import { config } from '../config/index.js'

const COLLECTION = 'cases'

// Read per call rather than at module import, so importing this repository
// does not require the config module to have been mocked first.
const creationDeadline = () => new Date(Date.now() + config.get('cases.creationDeadlineMs'))

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
  const prevDoc = await db.collection(COLLECTION).findOneAndUpdate(
    { correlationId },
    {
      $setOnInsert: {
        correlationId,
        caseId: null,
        creatorFileId: fileId,
        processedFileIds: [],
        createdAt: new Date(),
        creationDeadline: creationDeadline()
      }
    },
    { upsert: true, returnDocument: 'before' }
  )

  if (prevDoc === null) {
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

/**
 * Attempts to take over the creator role for a correlationId on behalf of
 * fileId, so that this file may create the CRM case instead of the file
 * originally responsible for it.
 *
 * Matches only when no case has been created yet, and when either no
 * creator has ever been recorded or the recorded creator's deadline has
 * passed. Because a MongoDB update against a single document is atomic,
 * at most one concurrent caller can match and win the role even when
 * several files attempt this at the same moment for the same
 * correlationId — the mechanism that keeps two cases from ever being
 * created for one submission. Extending creationDeadline on a successful
 * claim stops a second sibling displacing the new creator moments later.
 *
 * Deadlines are set and compared using each instance's own clock rather than
 * a server-authoritative one, so under clock skew between instances a
 * waiting file could consider a live creator expired slightly early or late.
 * Dataverse's own idempotent writes are the backstop that keeps this
 * ultimately safe even if that happens.
 *
 * @returns {Promise<boolean>} true when this fileId now owns the creator role.
 */
const claimCreatorRole = async (correlationId, fileId) => {
  const result = await db.collection(COLLECTION).findOneAndUpdate(
    {
      correlationId,
      caseId: null,
      $or: [
        { creatorFileId: null },
        { creationDeadline: { $lt: new Date() } }
      ]
    },
    {
      $set: {
        creatorFileId: fileId,
        creationDeadline: creationDeadline()
      }
    },
    { returnDocument: 'before' }
  )

  return result !== null
}

/**
 * Releases the creator role held by fileId for correlationId, so that
 * another file may claim it. Called after a creator's case creation fails
 * in a way that cannot be retried.
 *
 * Matches only on the exact fileId currently holding the role and only
 * while no case has been created, so a release triggered by a failure that
 * surfaces late cannot disturb a submission that has since been taken over
 * by a different file, or one that has since succeeded.
 *
 * @returns {Promise<boolean>} true when the role was released.
 */
const releaseCreator = async (correlationId, fileId) => {
  const result = await db.collection(COLLECTION).updateOne(
    { correlationId, creatorFileId: fileId, caseId: null },
    { $set: { creatorFileId: null } }
  )

  return result.modifiedCount > 0
}

export {
  setCorrelationIdIndex,
  upsertCase,
  markFileProcessed,
  updateCaseId,
  claimCreatorRole,
  releaseCreator
}
