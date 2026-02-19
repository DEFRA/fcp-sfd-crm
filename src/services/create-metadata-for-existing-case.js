import http2 from 'node:http2'
import Boom from '@hapi/boom'
import { createLogger } from '../logging/logger.js'
import {
  getContactIdFromCrn,
  getAccountIdFromSbi,
  createMetadataForExistingCase
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

export const createMetadataForExistingCaseinCrm = async ({ authToken, crn, sbi, caseId, metadata, correlationId }) => {
  const requiredParams = {
    authToken,
    crn,
    sbi,
    caseId,
    metadata,
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
  const { error: caseError } = await createMetadataForExistingCase({
    authToken,
    caseId,
    metadata: {
      ...metadata,
      contactId,
      accountId
    }
  })

  if (caseError) {
    logger.error(`Error creating metadata for existing case: ${caseError}`)
    throw internal('Unable to create metadata for existing case in CRM')
  }

  const eventData = {
    correlationId
  }

  publishReceivedEvent(
    {
      type: crmEvents.CASE_CREATED,
      data: eventData
    }
  )

  return {
    caseId
  }
}
