import { createLogger } from '../logging/logger.js'
import { getCrmAuthToken } from '../auth/get-crm-auth-token.js'
import { createCaseWithOnlineSubmissionInCrm, resolveDocumentTypeOrThrow } from './create-case-with-online-submission-in-crm.js'
import { upsertCase, updateCaseId, markFileProcessed } from '../repos/cases.js'
import { createMetadataForOnlineSubmission } from '../repos/crm.js'
import { fetchOnlineSubmissionActivityIdOrThrow } from './crm-helpers.js'
import { messages } from '../constants/messages.js'

const logger = createLogger()

const ONE_HOUR_MS = 60 * 60 * 1000

function buildCaseData (crm, file) {
  return {
    title: crm?.title || 'Document Upload',
    caseDescription: `Document uploaded: ${file?.fileName || 'Unknown file'}`,
    queue: crm?.caseType || 'Outgoing'
  }
}

function buildOnlineSubmissionActivity (file, correlationId) {
  return {
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
}

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

  return {
    crn,
    sbi,
    caseType: crm?.caseType || 'Document Upload',
    caseData: buildCaseData(crm, file),
    onlineSubmissionActivity: buildOnlineSubmissionActivity(file, correlationId),
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

  const prep = await prepareCase({ correlationId, fileId })

  if (prep.action === 'skip') {
    logger.info({ fileId }, 'Skipped: duplicate message')
    return { skipped: true, caseId: prep.caseId }
  }

  const authToken = await getCrmAuthToken()
  const transformedPayload = transformPayload(payload)

  if (prep.action === 'create') {
    return createNewCase({ authToken, transformedPayload, correlationId, fileId })
  }

  return addMetadataToExistingCase({
    authToken,
    caseId: prep.caseId,
    correlationId,
    file,
    fileId,
    caseType: transformedPayload.caseType
  })
}

async function prepareCase ({ correlationId, fileId }) {
  const { isNew, isDuplicateFile, caseId, isCreator } = await upsertCase(correlationId, fileId)

  if (isDuplicateFile) {
    return { action: 'skip', caseId }
  }

  if (!caseId && !isNew && !isCreator) {
    logger.info({ fileId }, 'Case creation in progress, will retry')
    const error = new Error('Case creation in progress for this correlationId')
    error.retryable = true
    throw error
  }

  if (isNew || (!caseId && isCreator)) {
    return { action: 'create' }
  }

  return { action: 'addMetadata', caseId }
}

async function createNewCase ({ authToken, transformedPayload, correlationId, fileId }) {
  const response = await createCaseWithOnlineSubmissionInCrm({ authToken, ...transformedPayload })

  await updateCaseId(correlationId, response.caseId)
  await markFileProcessed(correlationId, fileId)

  logger.info({
    event: { action: 'case-created', outcome: 'success', reference: response.caseId },
    fileId,
    rpaOnlinesubmissionid: response.rpaOnlinesubmissionid,
    contactId: response.contactId,
    accountId: response.accountId
  }, 'Case created')
  return response
}

async function addMetadataToExistingCase ({ authToken, caseId, correlationId, file, fileId, caseType }) {
  const onlineSubmissionActivityId = await fetchOnlineSubmissionActivityIdOrThrow(authToken, caseId, { fileId })

  // Additional files must be labelled with the same document type as the first
  // file in the submission, which is resolved from the case type at creation.
  const documentTypeMetadata = await resolveDocumentTypeOrThrow(authToken, caseType)

  const metadata = {
    name: file?.fileName || 'unknown',
    blobFileId: file?.fileId || null,
    documentTypeId: documentTypeMetadata.documentTypesId,
    mimeType: file?.contentType || null
  }

  const { metadataId, error: metadataError } = await createMetadataForOnlineSubmission({
    authToken,
    onlineSubmissionActivityId,
    metadata
  })

  if (metadataError) {
    if (metadataError.retryMetadata?.category === 'retryable') {
      const retryableErr = new Error(messages.METADATA_FAILURE)
      retryableErr.retryable = true
      retryableErr.retryMetadata = metadataError.retryMetadata
      throw retryableErr
    }
    logger.error({
      error: metadataError,
      event: {
        reference: caseId,
        category: metadataError.retryMetadata?.category ?? 'crm_metadata_create_failed',
        reason: metadataError.crmError ?? metadataError.message
      },
      fileId
    }, messages.METADATA_FAILURE)
    const error = new Error(messages.METADATA_FAILURE)
    error.retryable = false
    throw error
  }

  await markFileProcessed(correlationId, fileId)

  logger.info({ event: { reference: caseId }, fileId, metadataId }, 'Metadata added to existing case')
  return { caseId }
}
