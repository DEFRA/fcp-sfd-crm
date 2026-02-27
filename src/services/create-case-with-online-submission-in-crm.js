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
    logger.error(`Error creating case with online submission activity: ${caseError}`)
    throw internal('Unable to create case with online submission activity in CRM')
  }

  // Retrieve rpa_onlinesubmissionid for the created case
  let rpaOnlinesubmissionid
  try {
    rpaOnlinesubmissionid = await fetchRpaOnlineSubmissionIdOrThrow(authToken, caseId, { correlationId })
  } catch (err) {
    logger.error({ caseId, error }, 'Unable to retrieve online submission id')
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
