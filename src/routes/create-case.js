import { getCrmAuthToken } from '../auth/get-crm-auth-token.js'
import { validateApiKeyHeader } from '../api/common/helpers/validate-api-key-header'
import { createCaseInCrm } from '../services/create-case-in-crm.js'

export const postCreateCase = () => ({
  method: 'POST',
  path: '/create-case',
  options: {
    validate: validateApiKeyHeader(),
    handler: async (request) => {
      const authToken = await getCrmAuthToken()
      const { caseType, ...crmPayload } = request.payload
      const correlationId = request.info.id
      const caseResult = await createCaseInCrm({
        authToken,
        correlationId,
        caseType,
        ...crmPayload
      })

      return { caseResult }
    }
  }
})
