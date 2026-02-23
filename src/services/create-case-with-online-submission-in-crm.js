import http2 from 'node:http2'
import Boom from '@hapi/boom'
import { createLogger } from '../logging/logger.js'
import {
  getContactIdFromCrn,
  getAccountIdFromSbi,
  createCaseWithOnlineSubmission,
  getOnlineSubmissionIds
} from '../repos/crm.js'
import { crmEvents } from '../constants/events.js'
import { publishReceivedEvent } from '../messaging/outbound/received-event/publish-received-event.js'

const { constants: httpConstants } = http2
const { badRequest, boomify, internal } = Boom
const logger = createLogger()

const unprocessableEntity = (message) => {
  const error = new Error(message)
  return boomify(error, { statusCode: httpConstants.HTTP_STATUS_UNPROCESSABLE_ENTITY })
}

export const createCaseWithOnlineSubmissionInCrm = async ({ authToken, crn, sbi, caseData, onlineSubmissionActivity, correlationId }) => {
  const requiredParams = {
    authToken,
    crn,
    sbi,
    caseData,
    onlineSubmissionActivity,
    correlationId
  }

  for (const [param, value] of Object.entries(requiredParams)) {
    const errorMessage = `Missing required parameter: ${param}`

    if (!value) {
      logger.error(errorMessage)
      throw badRequest(errorMessage)
    }
  }

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
    logger.error(`Error creating case with online submission activity: ${caseError}`)
    throw internal('Unable to create case with online submission activity in CRM')
  }

  // Retrieve rpa_onlinesubmissionid for the created case
  const { rpaOnlinesubmissionid, error: getOnlineSubmissionError } = await getOnlineSubmissionIds(authToken, caseId)

  if (getOnlineSubmissionError || !rpaOnlinesubmissionid) {
    logger.error(`Unable to retrieve online submission id for case ${caseId}: ${getOnlineSubmissionError}`)
    throw internal('Unable to retrieve online submission for created case')
  }

  const eventData = {
    correlationId,
    caseId,
    crn,
    sbi
  }

  publishReceivedEvent(
    {
      type: crmEvents.CASE_CREATED,
      data: eventData
    }
  )

  return {
    contactId,
    accountId,
    caseId,
    rpaOnlinesubmissionid
  }
}
