import { createLogger } from '../logging/logger.js'
import { getOnlineSubmissionIds } from '../repos/crm.js'

const logger = createLogger()

export async function fetchRpaOnlineSubmissionIdOrThrow (authToken, caseId, context = {}) {
  const { correlationId } = context

  const { rpaOnlinesubmissionid, error } = await getOnlineSubmissionIds(authToken, caseId)

  if (error || !rpaOnlinesubmissionid) {
    logger.error({ correlationId, caseId, error }, 'Failed to retrieve online submission id')
    const err = new Error('Failed to retrieve online submission id')
    err.retryable = false
    throw err
  }

  return rpaOnlinesubmissionid
}

export default {
  fetchRpaOnlineSubmissionIdOrThrow
}
