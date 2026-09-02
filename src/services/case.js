import { createLogger } from '../logging/logger.js'
import { toTenantMessage } from '../logging/tenant-message.js'
import { getCrmAuthToken } from '../auth/get-crm-auth-token.js'
import { createCaseWithOnlineSubmissionInCrm, resolveDocumentTypeOrThrow } from './create-case-with-online-submission-in-crm.js'
import { upsertCase, updateCaseId, markFileProcessed, claimCreatorRole, releaseCreator } from '../repos/cases.js'
import { createMetadataForOnlineSubmission, createIntegrationInboundQueueRecord } from '../repos/crm.js'
import { fetchOnlineSubmissionActivityIdOrThrow } from './crm-helpers.js'
import { messages } from '../constants/messages.js'
import { metricsCounter } from '../api/common/helpers/metrics.js'
import { caseCreationMetrics, caseActions } from '../constants/case-creation-metrics.js'
import { isTerminalFailure } from '../utils/is-terminal-failure.js'
import { config } from '../config/index.js'
import { triageEventTypes, triageFailureReasons } from '../constants/integration-inbound-triage.js'

const logger = createLogger()

const ONE_HOUR_MS = 60 * 60 * 1000

const triageReasonFromTerminalReason = {
  document_type_not_found: triageFailureReasons.DOCUMENT_TYPE_NOT_FOUND,
  [triageFailureReasons.DOCUMENT_TYPE_METADATA_INCOMPLETE]: triageFailureReasons.DOCUMENT_TYPE_METADATA_INCOMPLETE
}

const classifyTriageFailureReason = (err) => {
  if (err?.triageFailureReason) {
    return err.triageFailureReason
  }

  if (err?.message === 'Contact ID not found') {
    return triageFailureReasons.CONTACT_NOT_FOUND_FOR_CRN
  }

  if (err?.message === 'Account ID not found') {
    return triageFailureReasons.ACCOUNT_NOT_FOUND_FOR_SBI
  }

  return triageReasonFromTerminalReason[err?.retryMetadata?.terminalReason] ?? null
}

const getConfiguredTriageProcessingEntity = () => {
  const rawValue = config.get('crm.integrationInboundFailureProcessingEntity')
  if (rawValue === null || rawValue === undefined) {
    return null
  }

  const value = String(rawValue).trim()
  return value.length ? value : null
}

const buildTriageErrorDetails = ({ correlationId, fileId, caseType, failureReason, errorMessage }) => JSON.stringify({
  correlationId,
  fileId,
  caseType,
  failureReason,
  errorMessage
})

const logTriageWriteSkipped = ({ correlationId, fileId, caseType, failureReason }) => {
  logger.warn({
    event: {
      type: triageEventTypes.WRITE_SKIPPED,
      action: 'skip_triage_record',
      category: 'crm',
      outcome: 'unknown',
      reason: triageFailureReasons.CONFIG_MISSING_OR_EMPTY,
      reference: correlationId
    },
    tenant: {
      message: toTenantMessage({ correlationId, fileId, caseType, failureReason })
    }
  }, 'Skipping CRM triage record write because processing entity config is missing or empty')
}

const logTriageWriteSuccess = ({ correlationId, fileId, caseType, failureReason, triageRecordId, created }) => {
  logger.info({
    event: {
      type: triageEventTypes.WRITE_SUCCEEDED,
      action: 'write_triage_record',
      category: 'crm',
      outcome: 'success',
      reason: created ? failureReason : triageFailureReasons.DUPLICATE_SUPPRESSED,
      reference: triageRecordId ?? correlationId
    },
    tenant: {
      message: toTenantMessage({ correlationId, fileId, caseType, failureReason, triageRecordId })
    }
  }, 'CRM triage record write completed')
}

const logTriageWriteFailed = ({ correlationId, fileId, caseType, failureReason, triageRecordId, triageError }) => {
  logger.error({
    event: {
      type: triageEventTypes.WRITE_FAILED,
      action: 'write_triage_record',
      category: 'crm',
      outcome: 'failure',
      reason: failureReason,
      reference: triageRecordId ?? correlationId
    },
    error: {
      message: triageError?.crmError ?? triageError?.message,
      type: triageError?.name,
      stack_trace: triageError?.stack,
      code: triageError?.retryMetadata?.status ?? null
    },
    tenant: {
      message: toTenantMessage({ correlationId, fileId, caseType, failureReason, triageRecordId })
    }
  }, 'CRM triage record write failed')
}

const reportInboundFailureForTriage = async ({ authToken, correlationId, fileId, caseType, err }) => {
  if (!isTerminalFailure(err)) {
    return
  }

  const failureReason = classifyTriageFailureReason(err)
  if (!failureReason) {
    return
  }

  const processingEntity = getConfiguredTriageProcessingEntity()
  if (!processingEntity) {
    logTriageWriteSkipped({ correlationId, fileId, caseType, failureReason })
    return
  }

  const { triageRecordId, created, error: triageError } = await createIntegrationInboundQueueRecord({
    authToken,
    correlationId,
    failureReason,
    processingEntity,
    errorDetails: buildTriageErrorDetails({
      correlationId,
      fileId,
      caseType,
      failureReason,
      errorMessage: err?.message
    })
  })

  if (triageError) {
    logTriageWriteFailed({ correlationId, fileId, caseType, failureReason, triageRecordId, triageError })
    return
  }

  logTriageWriteSuccess({ correlationId, fileId, caseType, failureReason, triageRecordId, created })
}

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

  const { crn, sbi, crm, file, correlationId, filesInBatch } = data

  return {
    crn,
    sbi,
    caseType: crm?.caseType || 'Document Upload',
    caseData: buildCaseData(crm, file),
    onlineSubmissionActivity: buildOnlineSubmissionActivity(file, correlationId),
    correlationId,
    filesInBatch
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

  if (prep.action === caseActions.SKIP) {
    logger.info({ tenant: { message: toTenantMessage({ fileId }) } }, 'Skipped: duplicate message')
    return { skipped: true, caseId: prep.caseId }
  }

  const authToken = await getCrmAuthToken()
  const transformedPayload = transformPayload(payload)
  const { caseType } = transformedPayload

  try {
    if (prep.action === caseActions.CREATE) {
      return await createNewCase({ authToken, transformedPayload, correlationId, fileId })
    }

    return await addMetadataToExistingCase({
      authToken,
      caseId: prep.caseId,
      correlationId,
      file,
      fileId,
      caseType
    })
  } catch (err) {
    await reportInboundFailureForTriage({ authToken, correlationId, fileId, caseType, err })
    throw err
  }
}

async function prepareCase ({ correlationId, fileId }) {
  const { isNew, isDuplicateFile, caseId, isCreator } = await upsertCase(correlationId, fileId)

  if (isDuplicateFile) {
    return { action: caseActions.SKIP, caseId }
  }

  const isWaitingForAnotherFilesCase = !isNew && !isCreator && !caseId
  const isThisFilesCaseToCreate = isNew || (isCreator && !caseId)

  if (isWaitingForAnotherFilesCase) {
    if (await claimCreatorRole(correlationId, fileId)) {
      await recordCreatorRoleTransition({
        metric: caseCreationMetrics.CREATOR_ROLE_CLAIMED,
        action: 'claim_creator_role',
        correlationId,
        fileId
      }, 'Creator role reassigned to this file')
      return { action: caseActions.CREATE }
    }

    await metricsCounter(caseCreationMetrics.WAITING_FOR_CASE)
    logger.info({ tenant: { message: toTenantMessage({ fileId }) } }, 'Case creation in progress, will retry')
    const error = new Error('Case creation in progress for this correlationId')
    error.retryable = true
    throw error
  }

  if (isThisFilesCaseToCreate) {
    return { action: caseActions.CREATE }
  }

  return { action: caseActions.ADD_METADATA, caseId }
}

/**
 * Emits a creator-role transition as both a metric and a log line, under the
 * one name. The metric name doubles as the log `event.type` so that a name
 * found in either place refers to the same transition.
 */
async function recordCreatorRoleTransition ({ metric, action, correlationId, fileId }, message) {
  await metricsCounter(metric)
  logger.info({
    event: { type: metric, action, category: 'crm', outcome: 'success', reference: correlationId },
    tenant: { message: toTenantMessage({ fileId }) }
  }, message)
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
    await metricsCounter(caseCreationMetrics.CREATOR_RELEASE_FAILED)
    logger.error({
      error: releaseError,
      event: { type: caseCreationMetrics.CREATOR_RELEASE_FAILED, category: 'crm', reason: 'creator_release_failed' },
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
    // A message about to dead-letter must not take the creator role with it,
    // or its siblings wait for the deadline instead of proceeding at once.
    if (isTerminalFailure(err) && await releaseCreatorRole(correlationId, fileId)) {
      await recordCreatorRoleTransition({
        metric: caseCreationMetrics.CREATOR_ROLE_RELEASED,
        action: 'release_creator_role',
        correlationId,
        fileId
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
