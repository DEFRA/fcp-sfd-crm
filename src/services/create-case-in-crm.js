import { createLogger } from '../logging/logger.js'
import {
  getContactIdFromCrn,
  getAccountIdFromSbi,
  createCase
} from '../repos/crm.js'
import { publishReceivedEvent } from '../messaging/outbound/received-event/publish-received-event.js'

const logger = createLogger()

export const createCaseInCrm = async ({ authToken, crn, sbi, caseType, correlationId }) => {
  if (!authToken || !crn || !sbi) {
    const missingParameters = {
      ...(!authToken && { authToken: 'missing' }),
      ...(!crn && { crn: 'missing' }),
      ...(!sbi && { sbi: 'missing' })
    }

    const errorMessage = `Missing required parameters: ${Object.keys(missingParameters).join(', ')}`

    logger.error(errorMessage)
    throw new Error(errorMessage)
  }

  const { contactId, error: contactError } = await getContactIdFromCrn(authToken, crn)

  if (contactError || !contactId) {
    logger.error(`No contact found for CRN: ${crn}, error: ${contactError}`)
    throw new Error('Contact ID not found')
  }

  const { accountId, error: accountError } = await getAccountIdFromSbi(authToken, sbi)

  if (accountError || !accountId) {
    logger.error(`No account found for SBI: ${sbi}, error: ${accountError}`)
    throw new Error('Account ID not found')
  }

  const { caseId, error: caseError } = await createCase(authToken, contactId, accountId)

  if (caseError) {
    logger.error(`Error creating case: ${caseError}`)
    throw new Error('Unable to create case in CRM')
  }

  const eventData = {
    correlationId,
    caseId,
    caseType,
    crn,
    sbi
  }

  publishReceivedEvent({ data: eventData })

  return {
    contactId,
    accountId,
    caseId
  }
}
