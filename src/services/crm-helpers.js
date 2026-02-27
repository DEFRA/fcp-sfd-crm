import http2 from 'node:http2'
import Boom from '@hapi/boom'
import { createLogger } from '../logging/logger.js'
import {
  getOnlineSubmissionId,
  getContactIdFromCrn,
  getAccountIdFromSbi
} from '../repos/crm.js'

const logger = createLogger()
const { constants: httpConstants } = http2

const unprocessableEntity = (message) => {
  const error = new Error(message)
  return Boom.boomify(error, { statusCode: httpConstants.HTTP_STATUS_UNPROCESSABLE_ENTITY })
}

export function assertRequiredParams (requiredParams) {
  for (const [param, value] of Object.entries(requiredParams)) {
    const errorMessage = `Missing required parameter: ${param}`

    if (!value) {
      logger.error(errorMessage)
      throw Boom.badRequest(errorMessage)
    }
  }
}

export async function ensureContactAndAccount (authToken, crn, sbi) {
  const { contactId, error: contactError } = await getContactIdFromCrn(authToken, crn)

  if (contactError || !contactId) {
    logger.error(`No contact found for CRN: ${crn}, error: ${contactError}`)
    throw unprocessableEntity('Contact ID not found')
  }

  const { accountId, error: accountError } = await getAccountIdFromSbi(authToken, sbi)

  if (accountError || !accountId) {
    logger.error(`No account found for SBI: ${sbi}, error: ${accountError}`)
    throw unprocessableEntity('Account ID not found')
  }

  return { contactId, accountId }
}

export async function fetchRpaOnlineSubmissionIdOrThrow (authToken, caseId, context = {}) {
  const { correlationId } = context

  const { rpaOnlinesubmissionid, error } = await getOnlineSubmissionId(authToken, caseId)

  if (error || !rpaOnlinesubmissionid) {
    logger.error({ correlationId, caseId, error }, 'Failed to retrieve online submission id')
    const err = new Error('Failed to retrieve online submission id')
    err.retryable = false
    throw err
  }

  return rpaOnlinesubmissionid
}

export default {
  assertRequiredParams,
  ensureContactAndAccount,
  fetchRpaOnlineSubmissionIdOrThrow
}
