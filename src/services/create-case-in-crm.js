import { createLogger } from '../logging/logger.js'
import {
  getContactIdFromCrn,
  getAccountIdFromSbi,
  createCase
} from '../repos/crm.js'

const logger = createLogger()

export const createCaseInCrm = async ({ authToken, crn, sbi }) => {
  const contactObj = await getContactIdFromCrn(authToken, crn)
  const contactId = contactObj?.contactId

  if (!contactId) {
    logger.error(`No contact found for CRN: ${crn}`)
    throw new Error('Contact ID not found')
  }

  const accountObj = await getAccountIdFromSbi(authToken, sbi)
  const accountId = accountObj?.accountId

  if (!accountId) {
    logger.error(`No account found for SBI: ${sbi}`)
    throw new Error('Account ID not found')
  }

  const { caseId, error } = await createCase(authToken, contactId, accountId)

  if (error) {
    logger.error(`Error creating case: ${error}`)
    throw new Error('Unable to create case in CRM')
  }

  return {
    contactId,
    accountId,
    caseId
  }
}
