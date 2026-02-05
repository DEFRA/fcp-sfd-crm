import { getCrmAuthToken } from '../auth/get-crm-auth-token.js'
import { validateApiKeyHeader } from '../api/common/helpers/validate-api-key-header.js'
import { createCaseWithOnlineSubmissionInCrm } from '../services/create-case-with-online-submission-in-crm.js'

export const postCreateCaseWithOnlineSubmission = () => ({
  method: 'POST',
  path: '/create-case-with-online-submission',
  options: {
    validate: validateApiKeyHeader(),
    handler: async (request) => {
      const authToken = await getCrmAuthToken()
      const { caseType, ...crmPayload } = request.payload
      const correlationId = request.info.id
      const caseResult = await createCaseWithOnlineSubmissionInCrm({
        authToken,
        correlationId,
        caseType,
        ...crmPayload
      })

      return { caseResult }
    }
  }
})
