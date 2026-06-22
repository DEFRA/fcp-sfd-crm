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
const validateParams = ({ authToken, crn, sbi, caseData, onlineSubmissionActivity, correlationId }) => {
  const requiredParams = {
    authToken,
    crn,
    sbi,
    caseData,
    onlineSubmissionActivity,
    correlationId
  }

  assertRequiredParams(requiredParams)
}

const callCreateCase = async ({ authToken, caseData, onlineSubmissionActivity, contactId, accountId, correlationId }) => {
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
    if (caseError?.retryMetadata?.category === 'retryable') {
      caseError.retryable = true
      throw caseError
    }

    const err = internal('Unable to create case with online submission activity in CRM')
    err.retryable = false
    err.retryMetadata = caseError?.retryMetadata ?? null
    throw err
  }

  return caseId
}

const publishEvents = async ({ caseId, crn, sbi, correlationId }) => {
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
}


// Wrapper kept to preserve the original behaviour of using correlationId for logging
const fetchRpaOnlinesubmissionidWrapper = async (authToken, caseId, correlationId) => {
  try {
    return await fetchRpaOnlineSubmissionIdOrThrow(authToken, caseId, { correlationId })
  } catch (err) {
    logger.error({ caseId, error: err }, 'Unable to retrieve online submission id')
    if (err?.retryMetadata?.category === 'retryable') {
      err.retryable = true
      throw err
    }

    const thrown = internal('Unable to retrieve online submission for created case')
    thrown.retryable = false
    thrown.retryMetadata = err?.retryMetadata ?? null
    throw thrown
  }
}

export const createCaseWithOnlineSubmissionInCrm = async ({ authToken, correlationId, crn, sbi, caseData, onlineSubmissionActivity }) => {
  validateParams({ authToken, crn, sbi, caseData, onlineSubmissionActivity, correlationId })

  const { contactId, accountId } = await ensureContactAndAccount(authToken, crn, sbi)

  const caseId = await callCreateCase({ authToken, caseData, onlineSubmissionActivity, contactId, accountId, correlationId })

  await publishEvents({ caseId, crn, sbi, correlationId })

  const rpaOnlinesubmissionid = await fetchRpaOnlinesubmissionidWrapper(authToken, caseId, correlationId)

  return { contactId, accountId, caseId, rpaOnlinesubmissionid }
}
