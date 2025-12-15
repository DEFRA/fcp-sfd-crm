import {
  getContactIdFromCrn,
  getAccountIdFromSbi,
  createCase
} from '../repos/crm.js'
import { logger } from '../logging/logger.js'

export const createCaseInCrm = async ({authToken, crn, sbi }) => {
  const contactId = await getContactIdFromCrn(authToken, crn)

  if (!contactId) {
    logger.error(`No contact found for CRN: ${crn}`)
  }

  const accountId = await getAccountIdFromSbi(authToken, sbi)

  if (!accountId) {
    logger.error(`No account found for SBI: ${sbi}`)
  }

  const caseId = await createCase(authToken, contactId, accountId)

  return {
    contactId,
    accountId,
    caseId
  }
}
