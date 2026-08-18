import Boom from '@hapi/boom'
import { createLogger } from '../logging/logger.js'
import {
  createCaseWithOnlineSubmission,
  getCaseIdByOnlineSubmissionId,
  getDocumentTypeMetadata
} from '../repos/crm.js'
import { assertRequiredParams, ensureContactAndAccount } from './crm-helpers.js'
import { crmEvents } from '../constants/events.js'
import { publishReceivedEvent } from '../messaging/outbound/received-event/publish-received-event.js'

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
    throw err
  }

  logger.debug({ event: { category: caseType, reason: JSON.stringify(documentTypeMetadata, null, 4) } }, 'Document type metadata resolved successfully')

  return documentTypeMetadata
}

function throwCaseCreationError (caseError) {
  logger.error({
    error: caseError,
    event: {
      category: caseError?.retryMetadata?.category ?? 'crm_case_create_failed',
      reason: caseError?.crmError ?? caseError?.message
    }
  }, 'Error creating case with online submission activity')
  if (caseError?.retryMetadata?.category === 'retryable') {
    caseError.retryable = true
    throw caseError
  }
  const err = internal('Unable to create case with online submission activity in CRM')
  err.retryable = false
  err.retryMetadata = caseError?.retryMetadata ?? null
  throw err
}

async function fallbackLookupCaseIdOrThrow (authToken, rpaOnlinesubmissionid) {
  logger.warn({ rpaOnlinesubmissionid }, 'CRM POST response missing incidentid, falling back to lookup by online submission')
  const { caseId: fallbackCaseId, error: lookupError } = await getCaseIdByOnlineSubmissionId(authToken, rpaOnlinesubmissionid)

  if (lookupError || !fallbackCaseId) {
    logger.error({
      error: lookupError,
      event: {
        reference: rpaOnlinesubmissionid,
        category: lookupError?.retryMetadata?.category ?? 'fallback_case_lookup_failed',
        reason: lookupError?.crmError ?? lookupError?.message
      }
    }, 'Fallback lookup for caseId failed')
    const err = internal('CRM did not return a case ID and fallback lookup failed')
    err.retryable = true
    throw err
  }

  return fallbackCaseId
}

async function createCrmCaseOrThrow (authToken, contactId, accountId, caseData, onlineSubmissionActivity, documentTypeMetadata) {
  const { caseId, rpaOnlinesubmissionid, error: caseError } = await createCaseWithOnlineSubmission({
    authToken,
    case: { ...caseData, contactId, accountId, documentTypeMetadata },
    onlineSubmissionActivity
  })

  if (caseError) {
    throwCaseCreationError(caseError)
  }

  if (!caseId) {
    const fallbackCaseId = await fallbackLookupCaseIdOrThrow(authToken, rpaOnlinesubmissionid)
    return { caseId: fallbackCaseId, rpaOnlinesubmissionid }
  }

  return { caseId, rpaOnlinesubmissionid }
}

export const createCaseWithOnlineSubmissionInCrm = async ({ authToken, crn, sbi, caseType, caseData, onlineSubmissionActivity, correlationId }) => {
  assertRequiredParams({ authToken, crn, sbi, caseType, caseData, onlineSubmissionActivity, correlationId })

  const { contactId, accountId } = await ensureContactAndAccount(authToken, crn, sbi)
  const documentTypeMetadata = await resolveDocumentTypeOrThrow(authToken, caseType)
  const { caseId, rpaOnlinesubmissionid } = await createCrmCaseOrThrow(authToken, contactId, accountId, caseData, onlineSubmissionActivity, documentTypeMetadata)

  const eventData = { correlationId, caseId, crn: Number(crn), sbi: Number(sbi) }
  try {
    await publishReceivedEvent({ type: crmEvents.CASE_CREATED, data: eventData })
  } catch (error) {
    logger.error({ error, event: { reference: caseId } }, 'publishReceivedEvent threw unexpectedly — case creation still succeeded')
  }

  return { contactId, accountId, caseId, rpaOnlinesubmissionid }
}
