import Boom from '@hapi/boom'
import { createLogger } from '../logging/logger.js'
import { toTenantMessage } from '../logging/tenant-message.js'
import {
  createCaseWithOnlineSubmission,
  getDocumentTypeMetadata
} from '../repos/crm.js'
import { assertRequiredParams, ensureContactAndAccount } from './crm-helpers.js'
import { crmEvents } from '../constants/events.js'
import { publishReceivedEvent } from '../messaging/outbound/received-event/publish-received-event.js'
import { triageFailureReasons } from '../constants/integration-inbound-triage.js'

const { internal } = Boom
const logger = createLogger()

const NON_RETRYABLE = 'non-retryable'

export async function resolveDocumentTypeOrThrow (authToken, caseType) {
  const { documentTypeMetadata, error: docTypeError } = await getDocumentTypeMetadata(authToken, caseType)

  if (docTypeError) {
    if (docTypeError.message?.startsWith('Invalid caseType:')) {
      logger.warn({
        error: docTypeError,
        event: {
          category: docTypeError.retryMetadata?.category ?? 'invalid_case_type',
          reason: docTypeError.crmError ?? docTypeError.message
        },
        caseType
      }, 'Invalid caseType for document type lookup')
      const badRequestError = Boom.badRequest(docTypeError.message)
      badRequestError.retryable = false
      badRequestError.retryMetadata = { category: NON_RETRYABLE, status: 400 }
      throw badRequestError
    }

    logger.error({
      error: docTypeError,
      event: {
        category: docTypeError.retryMetadata?.category ?? 'document_type_lookup_failed',
        reason: docTypeError.crmError ?? docTypeError.message
      },
      caseType
    }, 'Error looking up document type metadata')
    if (docTypeError?.retryMetadata?.category === 'retryable') {
      docTypeError.retryable = true
      throw docTypeError
    }
    // Only non-retryable lookup failures reach here — the retryable case is
    // handled above. Retrying cannot change the outcome, so fail fast rather
    // than burning every receive attempt before the DLQ.
    const err = internal('Unable to look up document type metadata from CRM')
    err.retryable = false
    err.retryMetadata = {
      ...(docTypeError?.retryMetadata ?? { category: NON_RETRYABLE }),
      terminalReason: 'document_type_lookup_failed'
    }
    throw err
  }

  if (!documentTypeMetadata) {
    // CRM answered and has no document type for this case type. That is a data
    // or configuration problem, not a transient fault, so it never recovers on
    // retry. Writing a fallback instead would miscategorise the record in CRM.
    logger.error({
      event: { category: NON_RETRYABLE, reason: 'document_type_not_found' },
      caseType
    }, 'Document type metadata not found for caseType')
    const err = internal(`No document type metadata found for caseType: ${caseType}`)
    err.retryable = false
    err.retryMetadata = { category: NON_RETRYABLE, terminalReason: 'document_type_not_found' }
    err.triageFailureReason = triageFailureReasons.DOCUMENT_TYPE_NOT_FOUND
    throw err
  }

  logger.debug({ event: { category: caseType, reason: JSON.stringify(documentTypeMetadata, null, 4) } }, 'Document type metadata resolved successfully')

  return documentTypeMetadata
}

// A retryable case-creation failure — a timeout, a 5xx, a network error — is
// ambiguous: Dataverse may have committed the write despite the client never
// seeing a response. This distinct marker makes that ambiguity observable
// and countable, rather than indistinguishable from an ordinary retry, so it
// can be watched for the duplicate-case condition ahead
// of any given submission actually producing one.
function logCaseCreationOutcomeUnknown (caseError, { correlationId, fileId }) {
  logger.warn({
    event: {
      type: 'crm.case.create_outcome_unknown',
      action: 'create_case',
      category: 'crm',
      outcome: 'unknown',
      reason: caseError?.retryMetadata?.terminalReason ?? caseError?.message,
      reference: caseError?.derivedCaseId ?? null
    },
    tenant: { message: toTenantMessage({ correlationId, fileId, attempts: caseError?.retryMetadata?.attempts }) }
  }, 'Case creation outcome could not be confirmed — Dataverse may have committed it')
}

function throwCaseCreationError (caseError, { correlationId, fileId }) {
  const isRetryable = caseError?.retryMetadata?.category === 'retryable'

  logger.error({
    error: caseError,
    event: {
      type: 'crm.case.create_failed',
      action: 'create_case',
      category: caseError?.retryMetadata?.category ?? 'crm_case_create_failed',
      outcome: 'failure',
      reason: caseError?.crmError ?? caseError?.message,
      reference: caseError?.derivedCaseId ?? null
    }
  }, 'Error creating case with online submission activity')

  if (isRetryable) {
    logCaseCreationOutcomeUnknown(caseError, { correlationId, fileId })
    caseError.retryable = true
    throw caseError
  }
  const err = internal('Unable to create case with online submission activity in CRM')
  err.cause = caseError
  err.retryable = false
  err.retryMetadata = caseError?.retryMetadata ?? null
  err.triageFailureReason = caseError?.triageFailureReason ?? null
  throw err
}

async function createCrmCaseOrThrow ({ authToken, correlationId, fileId, contactId, accountId, caseData, onlineSubmissionActivity, documentTypeMetadata, filesInBatch }) {
  const { caseId, rpaOnlinesubmissionid, error: caseError } = await createCaseWithOnlineSubmission({
    authToken,
    correlationId,
    fileId,
    case: { ...caseData, contactId, accountId, documentTypeMetadata },
    onlineSubmissionActivity,
    filesInBatch
  })

  if (caseError) {
    throwCaseCreationError(caseError, { correlationId, fileId })
  }

  return { caseId, rpaOnlinesubmissionid }
}

export const createCaseWithOnlineSubmissionInCrm = async ({ authToken, crn, sbi, caseType, caseData, onlineSubmissionActivity, correlationId, fileId, filesInBatch }) => {
  assertRequiredParams({ authToken, crn, sbi, caseType, caseData, onlineSubmissionActivity, correlationId, fileId })

  const { contactId, accountId } = await ensureContactAndAccount(authToken, crn, sbi, { correlationId })
  const documentTypeMetadata = await resolveDocumentTypeOrThrow(authToken, caseType)
  const { caseId, rpaOnlinesubmissionid } = await createCrmCaseOrThrow({ authToken, correlationId, fileId, contactId, accountId, caseData, onlineSubmissionActivity, documentTypeMetadata, filesInBatch })

  const eventData = { correlationId, caseId, crn: Number(crn), sbi: Number(sbi) }
  try {
    await publishReceivedEvent({ type: crmEvents.CASE_CREATED, data: eventData })
  } catch (error) {
    logger.error({ error, event: { reference: caseId } }, 'publishReceivedEvent threw unexpectedly — case creation still succeeded')
  }

  return { contactId, accountId, caseId, rpaOnlinesubmissionid }
}
