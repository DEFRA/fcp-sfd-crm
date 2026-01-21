import { createLogger } from '../logging/logger.js'
import {
  getContactIdFromCrn,
  getAccountIdFromSbi,
  createCaseWithOnlineSubmission
} from '../repos/crm.js'

const logger = createLogger()

export const createCaseWithOnlineSubmissionInCrm = async ({ authToken, crn, sbi, caseData, onlineSubmissionActivity }) => {
  if (!authToken || !crn || !sbi || !caseData || !onlineSubmissionActivity) {
    const missingParameters = {
      ...(!authToken && { authToken: 'missing' }),
      ...(!crn && { crn: 'missing' }),
      ...(!sbi && { sbi: 'missing' }),
      ...(!caseData && { caseData: 'missing' }),
      ...(!onlineSubmissionActivity && { onlineSubmissionActivity: 'missing' })
    }

    logger.error(`Missing required parameters: ${Object.keys(missingParameters).join(', ')}`)
    throw new Error(`Missing required parameters: ${Object.keys(missingParameters).join(', ')}`)
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
