import { createLogger } from '../logging/logger.js'
import { toTenantMessage } from '../logging/tenant-message.js'
import { getCrmAuthToken } from '../auth/get-crm-auth-token.js'
import { createCaseWithOnlineSubmissionInCrm, resolveDocumentTypeOrThrow } from './create-case-with-online-submission-in-crm.js'
import { upsertCase, updateCaseId, markFileProcessed, claimCreatorRole, releaseCreator } from '../repos/cases.js'
import { createMetadataForOnlineSubmission } from '../repos/crm.js'
import { fetchOnlineSubmissionActivityIdOrThrow } from './crm-helpers.js'
import { messages } from '../constants/messages.js'
import { metricsCounter } from '../api/common/helpers/metrics.js'
import { caseCreationMetrics } from '../constants/case-creation-metrics.js'

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
    logger.info({ tenant: { message: toTenantMessage({ fileId }) } }, 'Skipped: duplicate message')
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
    if (await claimCreatorRole(correlationId, fileId)) {
      await metricsCounter(caseCreationMetrics.CREATOR_ROLE_CLAIMED)
      logger.info({
        event: { type: 'crm.case.creator_reassigned', action: 'claim_creator_role', category: 'crm', outcome: 'success', reference: correlationId },
        tenant: { message: toTenantMessage({ fileId }) }
      }, 'Creator role reassigned to this file')
      return { action: 'create' }
    }

    await metricsCounter(caseCreationMetrics.WAITING_FOR_CASE)
    logger.info({ tenant: { message: toTenantMessage({ fileId }) } }, 'Case creation in progress, will retry')
    const error = new Error('Case creation in progress for this correlationId')
    error.retryable = true
    throw error
  }

  if (isNew || (!caseId && isCreator)) {
    return { action: 'create' }
  }

  return { action: 'addMetadata', caseId }
}

/**
 * Releases the creator role, reporting rather than propagating its own
 * failure.
 *
 * A failed release must never replace the error that triggered it: the
 * dead letter record needs to explain the case-creation failure, not a
 * transient Mongo fault on the way out. The submission still recovers
 * through the creation deadline in that case, just more slowly.
 *
 * @returns {Promise<boolean>} true when the role was actually released.
 */
async function releaseCreatorRole (correlationId, fileId) {
  try {
    return await releaseCreator(correlationId, fileId)
  } catch (releaseError) {
    logger.error({
      error: releaseError,
      event: { category: 'crm', reason: 'creator_release_failed' },
      tenant: { message: toTenantMessage({ fileId }) }
    }, 'Failed to release creator role; submission will rely on the creation deadline')
    return false
  }
}

async function createNewCase ({ authToken, transformedPayload, correlationId, fileId }) {
  let response
  try {
    response = await createCaseWithOnlineSubmissionInCrm({ authToken, fileId, ...transformedPayload })
  } catch (err) {
    // Mirror the consumer's own terminal test (`if (err.retryable)` in
    // processValidatedMessage): release whenever it would dead-letter this
    // message, not only on an explicit retryable:false. Errors that never set
    // the flag reach here — Boom 400 from assertRequiredParams, Boom 422 from
    // ensureContactAndAccount — and would otherwise be dead-lettered while
    // still holding the role, stranding siblings until the deadline expires.
    if (!err.retryable && await releaseCreatorRole(correlationId, fileId)) {
      await metricsCounter(caseCreationMetrics.CREATOR_ROLE_RELEASED)
      logger.info({
        event: { type: 'crm.case.creator_released', action: 'release_creator_role', category: 'crm', outcome: 'success', reference: correlationId },
        tenant: { message: toTenantMessage({ fileId }) }
      }, 'Creator role released after non-retryable failure')
    }
    throw err
  }

  await updateCaseId(correlationId, response.caseId)
  await markFileProcessed(correlationId, fileId)

  logger.info({
    event: { action: 'case-created', outcome: 'success', reference: response.caseId },
    tenant: {
      message: toTenantMessage({
        fileId,
        rpaOnlinesubmissionid: response.rpaOnlinesubmissionid,
        contactId: response.contactId,
        accountId: response.accountId
      })
    }
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
    metadata,
    correlationId,
    fileId
  })

  if (metadataError) {
    if (metadataError.retryMetadata?.category === 'retryable') {
      const retryableErr = new Error(messages.METADATA_FAILURE, { cause: metadataError })
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
      tenant: { message: toTenantMessage({ fileId, onlineSubmissionActivityId }) }
    }, messages.METADATA_FAILURE)
    const error = new Error(messages.METADATA_FAILURE, { cause: metadataError })
    error.retryable = false
    error.retryMetadata = metadataError.retryMetadata ?? null
    throw error
  }

  await markFileProcessed(correlationId, fileId)

  // event.reference carries metadataId rather than caseId: caseId is already
  // recoverable from the earlier "Case created" line, while metadataId is a
  // one-way digest that lets a reader query Dataverse for this exact record
  // directly — the check that answers "was this file actually written".
  logger.info({
    event: { reference: metadataId },
    tenant: { message: toTenantMessage({ fileId, caseId }) }
  }, 'Metadata added to existing case')
  return { caseId }
}
