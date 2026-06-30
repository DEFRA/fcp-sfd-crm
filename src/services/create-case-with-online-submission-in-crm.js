import Boom from '@hapi/boom'
import { createLogger } from '../logging/logger.js'
import {
  createCaseWithOnlineSubmission,
  getDocumentTypeMetadata
} from '../repos/crm.js'
import { assertRequiredParams, ensureContactAndAccount, fetchRpaOnlineSubmissionIdOrThrow } from './crm-helpers.js'
import { crmEvents } from '../constants/events.js'
import { publishReceivedEvent } from '../messaging/outbound/received-event/publish-received-event.js'

const { internal } = Boom
const logger = createLogger()

export const createCaseWithOnlineSubmissionInCrm = async ({ authToken, crn, sbi, caseType, caseData, onlineSubmissionActivity, correlationId }) => {
  const requiredParams = {
    authToken,
    crn,
    sbi,
    caseType,
    caseData,
    onlineSubmissionActivity,
    correlationId
  }

  assertRequiredParams(requiredParams)

  const { contactId, accountId } = await ensureContactAndAccount(authToken, crn, sbi)

  const { documentTypeMetadata, error: docTypeError } = await getDocumentTypeMetadata(authToken, caseType)

  if (docTypeError) {
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

  const { caseId, error: caseError } = await createCaseWithOnlineSubmission({
    authToken,
    case: {
      ...caseData,
      contactId,
      accountId,
      documentTypeMetadata
    },
    onlineSubmissionActivity
  })

  if (caseError) {
    logger.error({ correlationId, error: caseError }, 'Error creating case with online submission activity')
    // If the CRM error indicates the request should be retried, surface that to the
    // consumer by throwing the original error with `retryable = true` so the
    // inbound consumer can leave the message on the queue.
    if (caseError?.retryMetadata?.category === 'retryable') {
      caseError.retryable = true
      throw caseError
    }

    const err = internal('Unable to create case with online submission activity in CRM')
    err.retryable = false
    err.retryMetadata = caseError?.retryMetadata ?? null
    throw err
  }

  // Retrieve rpa_onlinesubmissionid for the created case
  let rpaOnlinesubmissionid
  try {
    rpaOnlinesubmissionid = await fetchRpaOnlineSubmissionIdOrThrow(authToken, caseId, { correlationId })
  } catch (err) {
    logger.error({ caseId, error: err }, 'Unable to retrieve online submission id')
    // If the underlying error carries retry metadata and is retryable, rethrow
    // it so the inbound consumer can decide to leave the message on the queue.
    if (err?.retryMetadata?.category === 'retryable') {
      err.retryable = true
      throw err
    }

    const thrown = internal('Unable to retrieve online submission for created case')
    thrown.retryable = false
    thrown.retryMetadata = err?.retryMetadata ?? null
    throw thrown
  }

  const eventData = {
    correlationId,
    caseId,
    crn: Number(crn),
    sbi: Number(sbi)
  }

  try {
    await publishReceivedEvent({
      type: crmEvents.CASE_CREATED,
      data: eventData
    })
  } catch (err) {
    logger.error({ err, caseId, correlationId }, 'publishReceivedEvent threw unexpectedly — case creation still succeeded')
  }

  return {
    contactId,
    accountId,
    caseId,
    rpaOnlinesubmissionid
  }
}
