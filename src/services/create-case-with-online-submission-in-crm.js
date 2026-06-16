import Boom from '@hapi/boom'
import { createLogger } from '../logging/logger.js'
import {
  createCaseWithOnlineSubmission
} from '../repos/crm.js'
import { assertRequiredParams, ensureContactAndAccount, fetchRpaOnlineSubmissionIdOrThrow } from './crm-helpers.js'
import { crmEvents } from '../constants/events.js'
import { publishReceivedEvent } from '../messaging/outbound/received-event/publish-received-event.js'

const { internal } = Boom
const logger = createLogger()

export const createCaseWithOnlineSubmissionInCrm = async ({ authToken, crn, sbi, caseData, onlineSubmissionActivity, correlationId }) => {
  const requiredParams = {
    authToken,
    crn,
    sbi,
    caseData,
    onlineSubmissionActivity,
    correlationId
  }

  assertRequiredParams(requiredParams)

  const { contactId, accountId } = await ensureContactAndAccount(authToken, crn, sbi)

  const { caseId, error: caseError } = await createCaseWithOnlineSubmission({
    authToken,
    case: {
      ...caseData,
      contactId,
      accountId
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

  // Fire-and-forget publishing; handle any rejection to avoid unhandled rejections
  Promise.resolve(publishReceivedEvent(
    {
      type: crmEvents.CASE_CREATED,
      data: eventData
    }
  )).catch(err => {
    logger.error({ err, caseId, correlationId }, 'Error publishing received CRM request event')
  })

  // Also emit a document.created event so downstream systems know a document/case
  // was created; include the original correlationId from the inbound message.
  Promise.resolve(publishReceivedEvent(
    {
      type: crmEvents.DOCUMENT_CREATED,
      data: {
        correlationId,
        caseId,
        crn: Number(crn),
        sbi: Number(sbi)
      }
    }
  )).catch(err => {
    logger.error({ err, caseId, correlationId }, 'Error publishing document.created event')
  })

  return {
    contactId,
    accountId,
    caseId,
    rpaOnlinesubmissionid
  }
}
