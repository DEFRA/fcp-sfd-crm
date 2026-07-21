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

async function resolveDocumentTypeOrThrow (authToken, caseType, correlationId) {
  const { documentTypeMetadata, error: docTypeError } = await getDocumentTypeMetadata(authToken, caseType)

  if (docTypeError) {
    if (docTypeError.message?.startsWith('Invalid caseType:')) {
      logger.warn({ correlationId, caseType, error: docTypeError }, 'Invalid caseType for document type lookup')
      const badRequestError = Boom.badRequest(docTypeError.message)
      badRequestError.retryable = false
      badRequestError.retryMetadata = { category: 'non-retryable', status: 400 }
      throw badRequestError
    }

    logger.error({ correlationId, caseType, error: docTypeError }, 'Error looking up document type metadata')
    if (docTypeError?.retryMetadata?.category === 'retryable') {
      docTypeError.retryable = true
      throw docTypeError
    }
    const err = internal('Unable to look up document type metadata from CRM')
    err.retryable = true
    err.retryMetadata = docTypeError?.retryMetadata ?? null
    throw err
  }

  if (!documentTypeMetadata) {
    logger.warn({ correlationId, caseType }, 'Document type metadata not found for caseType')
    const err = internal(`No document type metadata found for caseType: ${caseType}`)
    err.retryable = true
    throw err
  }

  return documentTypeMetadata
}

async function createCrmCaseOrThrow (authToken, contactId, accountId, caseData, onlineSubmissionActivity, documentTypeMetadata, correlationId) {
  const { caseId, rpaOnlinesubmissionid, error: caseError } = await createCaseWithOnlineSubmission({
    authToken,
    case: { ...caseData, contactId, accountId, documentTypeMetadata },
    onlineSubmissionActivity
  })

  if (caseError) {
    logger.error({ correlationId, error: caseError }, 'Error creating case with online submission activity')
    if (caseError?.retryMetadata?.category === 'retryable') {
      caseError.retryable = true
      throw caseError
    }
    const err = internal('Unable to create case with online submission activity in CRM')
    err.retryable = false
    err.retryMetadata = caseError?.retryMetadata ?? null
    throw err
  }

  if (!caseId) {
    logger.warn({ correlationId, rpaOnlinesubmissionid }, 'CRM POST response missing incidentid, falling back to lookup by online submission')
    const { caseId: fallbackCaseId, error: lookupError } = await getCaseIdByOnlineSubmissionId(authToken, rpaOnlinesubmissionid)

    if (lookupError || !fallbackCaseId) {
      logger.error({ correlationId, rpaOnlinesubmissionid, error: lookupError }, 'Fallback lookup for caseId failed')
      const err = internal('CRM did not return a case ID and fallback lookup failed')
      err.retryable = true
      throw err
    }

    return { caseId: fallbackCaseId, rpaOnlinesubmissionid }
  }

  return { caseId, rpaOnlinesubmissionid }
}

export const createCaseWithOnlineSubmissionInCrm = async ({ authToken, crn, sbi, caseType, caseData, onlineSubmissionActivity, correlationId }) => {
  assertRequiredParams({ authToken, crn, sbi, caseType, caseData, onlineSubmissionActivity, correlationId })

  const { contactId, accountId } = await ensureContactAndAccount(authToken, crn, sbi)
  const documentTypeMetadata = await resolveDocumentTypeOrThrow(authToken, caseType, correlationId)
  const { caseId, rpaOnlinesubmissionid } = await createCrmCaseOrThrow(authToken, contactId, accountId, caseData, onlineSubmissionActivity, documentTypeMetadata, correlationId)

  const eventData = { correlationId, caseId, crn: Number(crn), sbi: Number(sbi) }
  try {
    await publishReceivedEvent({ type: crmEvents.CASE_CREATED, data: eventData })
  } catch (err) {
    logger.error({ err, caseId, correlationId }, 'publishReceivedEvent threw unexpectedly — case creation still succeeded')
  }

  return { contactId, accountId, caseId, rpaOnlinesubmissionid }
}
