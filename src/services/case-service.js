import { createLogger } from '../logging/logger.js'
import { createCaseWithOnlineSubmissionInCRM } from './create-case-with-online-submission-in-crm.js'

const logger = createLogger()

/**
 * Create a case in CRM via the existing API service
 * @param {object} payload - parsed message payload
 */
export async function createCase(payload) {
    try {
        const response = await createCaseWithOnlineSubmissionInCRM(payload)
        logger.info('Case successfully created via CRM API', { caseId: payload.caseId, response })
        return response
    } catch (err) {
        logger.error('Failed to create case via CRM API', err)
        throw err // rethrow so message handler logs but continues
    }
}
