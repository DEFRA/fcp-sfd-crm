import { createLogger } from '../logging/logger.js'
import { getCrmAuthToken } from '../auth/get-crm-auth-token.js'
import { createCaseWithOnlineSubmissionInCrm } from './create-case-with-online-submission-in-crm.js'
import { upsertCase, updateCaseId, markFileProcessed } from '../repos/cases.js'
import { getOnlineSubmissionIds, createMetadataForOnlineSubmission } from '../repos/crm.js'

const logger = createLogger()

/**
 * Transform CloudEvents payload to the format expected by createCaseWithOnlineSubmissionInCrm
 * @param {object} cloudEventPayload - CloudEvents format payload with data property
 * @returns {object} Transformed payload
 */
export function transformPayload (cloudEventPayload) {
  // Extract data from CloudEvents format
  const { data } = cloudEventPayload

  if (!data) {
    throw new Error('Missing data property in CloudEvents payload')
  }

  const { crn, sbi, crm, file, correlationId } = data

  const caseData = {
    title: crm?.title || 'Document Upload',
    caseDescription: `Document uploaded: ${file?.fileName || 'Unknown file'}`,
    queue: crm?.caseType || 'Outgoing'
  }

  const onlineSubmissionActivity = {
    subject: `Document Upload - ${file?.fileName || 'Unknown'}`,
    description: `File uploaded: ${file?.fileName || 'Unknown file'}\nCorrelation ID: ${correlationId}`,
    scheduledStart: new Date().toISOString(),
    scheduledEnd: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
    stateCode: 0,
    statusCode: 1,
    metadata: {
      name: file?.fileName || 'unknown',
      documentType: 'default', // TODO: Map from file type
      fileUrl: file?.url || ''
    }
  }

  return {
    crn,
    sbi,
    caseType: 'Document Upload',
    caseData,
    onlineSubmissionActivity,
    correlationId
  }
}

/**
 * Process a file upload event with two-level deduplication.
 *
 * Level 1 — correlationId:  first file creates a CRM case; subsequent
 *           files for the same correlationId add metadata to it.
 * Level 2 — correlationId + fileId:  exact duplicate messages are skipped.
 *
 * @param {object} payload - parsed CloudEvents message payload
 */
export async function createCase (payload) {
  const { correlationId, file } = payload.data
  const fileId = file?.fileId

  // Step 1 — atomic upsert: determine our role
  const { isNew, isDuplicateFile, caseId, isCreator } = await upsertCase(correlationId, fileId)

  // Exact duplicate message (same correlationId + fileId already processed)
  if (isDuplicateFile) {
    logger.info({ correlationId, fileId }, 'Skipped: duplicate message')
    return { skipped: true }
  }

  // Another message is still creating the case — let SQS retry later (we're not the creator)
  if (!caseId && !isNew && !isCreator) {
    logger.info({ correlationId, fileId }, 'Case creation in progress, will retry')
    const error = new Error('Case creation in progress for this correlationId')
    error.retryable = true
    throw error
  }

  const authToken = await getCrmAuthToken()
  const transformedPayload = transformPayload(payload)
  // First message OR creator retrying after a previous failure
  if (isNew || (!caseId && isCreator)) {
    const response = await createCaseWithOnlineSubmissionInCrm({
      authToken,
      ...transformedPayload
    })

    await updateCaseId(correlationId, response.caseId)
    await markFileProcessed(correlationId, fileId)

    logger.info({ correlationId, caseId: response.caseId }, 'Case created')
    return response
  }

  // Case exists — add metadata for this new file

  // Retrieve the rpa_onlinesubmissionid for the existing case
  const { rpaOnlinesubmissionid, error: getOnlineSubmissionError } = await getOnlineSubmissionIds(authToken, caseId)

  if (getOnlineSubmissionError || !rpaOnlinesubmissionid) {
    logger.error({ correlationId, caseId, error: getOnlineSubmissionError }, 'Failed to retrieve online submission id')
    const error = new Error('Failed to retrieve online submission id')
    error.retryable = false
    throw error
  }

  const metadata = {
    name: file?.fileName || 'unknown',
    fileUrl: file?.url || '',
    documentTypeId: undefined
  }

  const { metadataId, error: metadataError } = await createMetadataForOnlineSubmission({
    authToken,
    rpaOnlinesubmissionid,
    metadata
  })

  if (metadataError) {
    logger.error({ correlationId, caseId, fileId, error: metadataError }, 'Failed to add metadata for additional file')
    const error = new Error('Failed to add metadata for additional file')
    error.retryable = false
    throw error
  }

  await markFileProcessed(correlationId, fileId)

  logger.info({ correlationId, caseId, fileId, metadataId }, 'Metadata added to existing case')
  return { caseId }
}
