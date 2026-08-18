import http2 from 'node:http2'
import Boom from '@hapi/boom'
import { createLogger } from '../logging/logger.js'
import {
  getOnlineSubmissionActivityId,
  getContactIdFromCrn,
  getAccountIdFromSbi
} from '../repos/crm.js'
import { messages } from '../constants/messages.js'

const logger = createLogger()
const { constants: httpConstants } = http2

const MASK_VISIBLE_DIGITS = 4

export function maskCrn (crn) {
  if (crn === null || crn === undefined) { return '****' }
  const str = String(crn)
  if (str.length <= MASK_VISIBLE_DIGITS) { return str }
  return '*'.repeat(str.length - MASK_VISIBLE_DIGITS) + str.slice(-MASK_VISIBLE_DIGITS)
}

const unprocessableEntity = (message) => {
  const error = new Error(message)
  return Boom.boomify(error, { statusCode: httpConstants.HTTP_STATUS_UNPROCESSABLE_ENTITY })
}

export function assertRequiredParams (requiredParams) {
  for (const [param, value] of Object.entries(requiredParams)) {
    const errorMessage = `Missing required parameter: ${param}`

    if (value === null || value === undefined) {
      logger.error(errorMessage)
      throw Boom.badRequest(errorMessage)
    }
  }
}

export async function ensureContactAndAccount (authToken, crn, sbi) {
  const { contactId, error: contactError } = await getContactIdFromCrn(authToken, crn)

  if (contactError) {
    if (contactError.retryMetadata?.category === 'retryable') {
      const err = new Error(`Retryable error looking up contact for CRN: ${maskCrn(crn)}`)
      err.retryable = true
      err.retryMetadata = contactError.retryMetadata
      throw err
    }
    logger.error(`No contact found for CRN: ${maskCrn(crn)}, error: ${contactError}`)
    throw unprocessableEntity('Contact ID not found')
  }

  if (!contactId) {
    logger.error(`No contact found for CRN: ${maskCrn(crn)}`)
    throw unprocessableEntity('Contact ID not found')
  }

  const { accountId, error: accountError } = await getAccountIdFromSbi(authToken, sbi)

  if (accountError) {
    if (accountError.retryMetadata?.category === 'retryable') {
      const err = new Error(`Retryable error looking up account for SBI: ${sbi}`)
      err.retryable = true
      err.retryMetadata = accountError.retryMetadata
      throw err
    }
    logger.error(`No account found for SBI: ${sbi}, error: ${accountError}`)
    throw unprocessableEntity('Account ID not found')
  }

  if (!accountId) {
    logger.error(`No account found for SBI: ${sbi}`)
    throw unprocessableEntity('Account ID not found')
  }

  return { contactId, accountId }
}

export async function fetchOnlineSubmissionActivityIdOrThrow (authToken, caseId, { fileId } = {}) {
  const { onlineSubmissionActivityId, error } = await getOnlineSubmissionActivityId(authToken, caseId)

  if (error) {
    if (error.retryMetadata?.category === 'retryable') {
      const retryableErr = new Error(messages.SUBMISSION_ID_FAILURE)
      retryableErr.retryable = true
      retryableErr.retryMetadata = error.retryMetadata
      throw retryableErr
    }
    logger.error({
      error,
      event: {
        reference: caseId,
        category: error.retryMetadata?.category ?? 'online_submission_lookup_failed',
        reason: error.crmError ?? error.message
      },
      fileId
    }, messages.SUBMISSION_ID_FAILURE)
    const err = new Error(messages.SUBMISSION_ID_FAILURE)
    err.retryable = false
    err.retryMetadata = error.retryMetadata ?? null
    throw err
  }

  if (!onlineSubmissionActivityId) {
    // The online submission is created in the same request as the case, but is
    // not always immediately queryable afterwards. A miss here is ordinarily
    // that transient window rather than a genuine absence, so it is retried up
    // to the queue's receive limit instead of going straight to the DLQ.
    logger.warn({
      event: { reference: caseId, category: 'retryable', reason: 'online_submission_not_yet_queryable' },
      fileId
    }, 'Online submission not yet queryable, will retry')
    const err = new Error(messages.SUBMISSION_ID_FAILURE)
    err.retryable = true
    err.retryMetadata = { category: 'retryable', terminalReason: 'online_submission_not_found' }
    throw err
  }

  return onlineSubmissionActivityId
}
