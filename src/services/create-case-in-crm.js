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

  const { caseId, error } = await createCase(authToken, contactId, accountId)

  if (error) {
    logger.error(`Error creating case: ${error}`)
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
