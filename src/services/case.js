import { createLogger } from '../logging/logger.js'
import { getCrmAuthToken } from '../auth/get-crm-auth-token.js'
import { createCaseWithOnlineSubmissionInCrm } from './create-case-with-online-submission-in-crm.js'
import { findByCorrelationId, create } from '../repos/cases.js'
import { MONGO_DUPLICATE_KEY_ERROR_CODE } from '../constants/mongodb.js'

const logger = createLogger()

/**
 * Transform CloudEvents payload to the format expected by createCaseWithOnlineSubmissionInCrm
 * @param {object} cloudEventPayload - CloudEvents format payload with data property
 * @returns {object} Transformed payload
 */
export function transformPayload (cloudEventPayload) {
  // Extract data from CloudEvents format
  const { data } = cloudEventPayload

  if (!data) {
    throw new Error('Missing data property in CloudEvents payload')
  }

  const { crn, sbi, crm, file, correlationId } = data

  const caseData = {
    title: crm?.title || 'Document Upload',
    caseDescription: `Document uploaded: ${file?.fileName || 'Unknown file'}`,
    queue: crm?.caseType || 'Outgoing'
  }

  const onlineSubmissionActivity = {
    subject: `Document Upload - ${file?.fileName || 'Unknown'}`,
    description: `File uploaded: ${file?.fileName || 'Unknown file'}\nCorrelation ID: ${correlationId}`,
    scheduledStart: new Date().toISOString(),
    scheduledEnd: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
    stateCode: 0,
    statusCode: 1,
    metadata: {
      name: file?.fileName || 'unknown',
      documentType: 'default', // TODO: Map from file type
      fileUrl: file?.url || ''
    }
  }

  return {
    crn,
    sbi,
    caseType: 'Document Upload',
    caseData,
    onlineSubmissionActivity,
    correlationId
  }
}

/**
 * Create a case in CRM via the existing API service.
 * Deduplicates by correlationId using MongoDB unique index.
 * @param {object} payload - parsed CloudEvents message payload
 */
export async function createCase (payload) {
  const { correlationId } = payload.data

  // Check if case already exists for this correlationId
  const existingCase = await findByCorrelationId(correlationId)

  if (existingCase) {
    logger.info({ caseId: existingCase.caseId }, 'Skipped: case already exists')

    return { caseId: existingCase.caseId }
  }

  try {
    // Get auth token
    const authToken = await getCrmAuthToken()

    // Transform CloudEvents payload to expected format
    const transformedPayload = transformPayload(payload)

    // Create case with auth token
    const response = await createCaseWithOnlineSubmissionInCrm({
      authToken,
      ...transformedPayload
    })

    try {
      await create({ correlationId, caseId: response.caseId })
    } catch (err) {
      if (err.code === MONGO_DUPLICATE_KEY_ERROR_CODE) {
        logger.info({ correlationId }, 'Duplicate correlationId, case already saved by concurrent request')
        return { caseId: response.caseId }
      }
      throw err
    }

    logger.info({ correlationId, caseId: response.caseId }, 'Case created')
    return response
  } catch (err) {
    logger.error('Failed to create case via CRM API', err)
    throw err
  }
}
