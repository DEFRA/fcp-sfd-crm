import {
  getContactIdFromCrn,
  getAccountIdFromSbi,
  createCaseWithOnlineSubmission
} from '../repos/crm.js'
import { createLogger } from '../logging/logger.js'

const logger = createLogger()

export const createCaseWithOnlineSubmissionInCrm = async ({ authToken, crn, sbi, caseData, onlineSubmissionActivity }) => {
  const requiredParams = {
    authToken,
    crn,
    sbi,
    caseData,
    onlineSubmissionActivity
  }

  for (const [param, value] of Object.entries(requiredParams)) {
    if (!value) {
      logger.error(`Missing required parameter: ${param}`)
      throw new Error(`Missing required parameter: ${param}`)
    }
  }

  const contactObj = await getContactIdFromCrn(authToken, crn)
  const contactId = contactObj?.contactId

  if (!contactId) {
    logger.error(`No contact found for CRN: ${crn}, error: ${contactObj?.error}`)
    throw new Error('Contact ID not found')
  }

  const accountObj = await getAccountIdFromSbi(authToken, sbi)
  const accountId = accountObj?.accountId

  if (!accountId) {
    logger.error(`No account found for SBI: ${sbi}, error: ${accountObj?.error}`)
    throw new Error('Account ID not found')
  }

  const { caseId, error } = await createCaseWithOnlineSubmission({
    authToken,
    case: {
      ...caseData,
      contactId,
      accountId
    },
    onlineSubmissionActivity
  })

  if (error) {
    logger.error(`Error creating case with online submission activity: ${error}`)
    throw new Error('Unable to create case with online submission activity in CRM')
  }

  return {
    contactId,
    accountId,
    caseId
  }
}
