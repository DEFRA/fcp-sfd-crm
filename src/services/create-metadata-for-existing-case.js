import Boom from '@hapi/boom'
import { createLogger } from '../logging/logger.js'
import {
  createMetadataForExistingCase
} from '../repos/crm.js'
import { crmEvents } from '../constants/events.js'
import { publishReceivedEvent } from '../messaging/outbound/received-event/publish-received-event.js'
import { assertRequiredParams, ensureContactAndAccount } from './crm-helpers.js'

const { internal } = Boom
const logger = createLogger()

export const createMetadataForExistingCaseinCrm = async ({ authToken, crn, sbi, caseId, metadata, correlationId }) => {
  const requiredParams = {
    authToken,
    crn,
    sbi,
    caseId,
    metadata,
    correlationId
  }

  assertRequiredParams(requiredParams)

  const { contactId, accountId } = await ensureContactAndAccount(authToken, crn, sbi)

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
