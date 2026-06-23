import http2 from 'node:http2'
import Boom from '@hapi/boom'
import { createLogger } from '../logging/logger.js'
import {
  getOnlineSubmissionId,
  getContactIdFromCrn,
  getAccountIdFromSbi
} from '../repos/crm.js'
import { messages } from '../constants/messages.js'

const logger = createLogger()
const { constants: httpConstants } = http2

const unprocessableEntity = (message) => {
  const error = new Error(message)
  return Boom.boomify(error, { statusCode: httpConstants.HTTP_STATUS_UNPROCESSABLE_ENTITY })
}

export function assertRequiredParams(requiredParams) {
  for (const [param, value] of Object.entries(requiredParams)) {
    const errorMessage = `Missing required parameter: ${param}`

    if (value === null || value === undefined) {
      logger.error(errorMessage)
      throw Boom.badRequest(errorMessage)
    }
  }
}

export async function ensureContactAndAccount(authToken, crn, sbi, correlationId) {
  const { contactId, error: contactError } = await getContactIdFromCrn(authToken, crn, { correlationId })

  if (contactError) {
    if (contactError.retryMetadata?.category === 'retryable') {
      const err = new Error(`Retryable error looking up contact for CRN: ${crn}`)
      err.retryable = true
      err.retryMetadata = contactError.retryMetadata
      throw err
    }
    logger.error(`No contact found for CRN: ${crn}, error: ${contactError}`)
    throw unprocessableEntity('Contact ID not found')
  }

  if (!contactId) {
    logger.error(`No contact found for CRN: ${crn}`)
    throw unprocessableEntity('Contact ID not found')
  }

  const { accountId, error: accountError } = await getAccountIdFromSbi(authToken, sbi, { correlationId })

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

export async function fetchRpaOnlineSubmissionIdOrThrow(authToken, caseId, context = {}) {
  const { correlationId } = context

  const { rpaOnlinesubmissionid, error } = await getOnlineSubmissionId(authToken, caseId)

  if (error) {
    if (error.retryMetadata?.category === 'retryable') {
      const retryableErr = new Error(messages.SUBMISSION_ID_FAILURE)
      retryableErr.retryable = true
      retryableErr.retryMetadata = error.retryMetadata
      throw retryableErr
    }
    logger.error({ correlationId, caseId, error }, messages.SUBMISSION_ID_FAILURE)
    const err = new Error(messages.SUBMISSION_ID_FAILURE)
    err.retryable = false
    throw err
  }

  if (!rpaOnlinesubmissionid) {
    logger.error({ correlationId, caseId }, 'Online submission id not found')
    const err = new Error(messages.SUBMISSION_ID_FAILURE)
    err.retryable = false
    throw err
  }

  return rpaOnlinesubmissionid
}
