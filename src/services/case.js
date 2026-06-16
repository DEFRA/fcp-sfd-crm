import { createLogger } from '../logging/logger.js'
import { getCrmAuthToken } from '../auth/get-crm-auth-token.js'
import { createCaseWithOnlineSubmissionInCrm } from './create-case-with-online-submission-in-crm.js'
import { upsertCase, updateCaseId, markFileProcessed } from '../repos/cases.js'
import { createMetadataForOnlineSubmission } from '../repos/crm.js'
import { fetchRpaOnlineSubmissionIdOrThrow } from './crm-helpers.js'
import { publishReceivedEvent } from '../messaging/outbound/received-event/publish-received-event.js'
import { crmEvents } from '../constants/events.js'

const logger = createLogger()

const ONE_HOUR_MS = 60 * 60 * 1000

/**
 * Transform CloudEvents payload to the format expected by createCaseWithOnlineSubmissionInCrm
 * @param {object} cloudEventPayload - CloudEvents format payload with data property
 * @returns {object} Transformed payload
 */
export function transformPayload(cloudEventPayload) {
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
    scheduledEnd: new Date(Date.now() + ONE_HOUR_MS).toISOString(),
    stateCode: 0,
    statusCode: 1,
    metadata: {
      name: file?.fileName || 'unknown',
      documentType: 'default',
      blobFileId: file?.fileId || null,
      mimeType: file?.contentType || null
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
export async function createCase(payload) {
  const { correlationId, file } = payload.data
  const fileId = file?.fileId

  const prep = await prepareCase({ correlationId, fileId })

  if (prep.action === 'skip') {
    logger.info({ correlationId, fileId }, 'Skipped: duplicate message')
    return { skipped: true, caseId: prep.caseId }
  }

  const authToken = await getCrmAuthToken()
  const transformedPayload = transformPayload(payload)

  if (prep.action === 'create') {
    return createNewCase({ authToken, transformedPayload, correlationId, fileId })
  }

  return addMetadataToExistingCase({ authToken, caseId: prep.caseId, correlationId, file, fileId, transformedPayload })
}

async function prepareCase({ correlationId, fileId }) {
  const { isNew, isDuplicateFile, caseId, isCreator } = await upsertCase(correlationId, fileId)

  if (isDuplicateFile) {
    return { action: 'skip', caseId }
  }

  if (!caseId && !isNew && !isCreator) {
    logger.info({ correlationId, fileId }, 'Case creation in progress, will retry')
    const error = new Error('Case creation in progress for this correlationId')
    error.retryable = true
    throw error
  }

  if (isNew || (!caseId && isCreator)) {
    return { action: 'create' }
  }

  return { action: 'addMetadata', caseId }
}

async function createNewCase({ authToken, transformedPayload, correlationId, fileId }) {
  const response = await createCaseWithOnlineSubmissionInCrm({ authToken, ...transformedPayload })

  await updateCaseId(correlationId, response.caseId)
  await markFileProcessed(correlationId, fileId)

  logger.info({ correlationId, caseId: response.caseId }, 'Case created')
  return response
}

async function addMetadataToExistingCase({ authToken, caseId, correlationId, file, fileId, transformedPayload }) {
  const rpaOnlinesubmissionid = await fetchRpaOnlineSubmissionIdOrThrow(authToken, caseId, { correlationId })

  const metadata = {
    name: file?.fileName || 'unknown',
    blobFileId: file?.fileId || null,
    documentTypeId: null,
    mimeType: file?.contentType || null
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
  // Emit document.created event with metadataId so downstream systems can act on the
  // newly-created metadata record. Include correlationId and caseId and the original
  // CRN/SBI if available from the transformed payload.
  const eventData = {
    correlationId,
    caseId,
    metadataId,
    crn: transformedPayload?.crn ? Number(transformedPayload.crn) : undefined,
    sbi: transformedPayload?.sbi ? Number(transformedPayload.sbi) : undefined
  }

  Promise.resolve(publishReceivedEvent({ type: crmEvents.DOCUMENT_CREATED, data: eventData }))
    .catch(err => {
      logger.error({ err, caseId, correlationId, metadataId }, 'Error publishing document.created event after metadata creation')
    })

  return { caseId }
}
