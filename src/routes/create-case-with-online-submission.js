import http2 from 'node:http2'

import { getCrmAuthToken } from '../auth/get-crm-auth-token.js'
import { validateApiKeyHeader } from '../api/common/helpers/validate-api-key-header.js'
import { createCaseWithOnlineSubmissionInCrm } from '../services/create-case-with-online-submission-in-crm.js'
import { createCasePayloadSchema, validationOptions } from '../api/schemas/index.js'

export const postCreateCaseWithOnlineSubmission = () => ({
  method: 'POST',
  path: '/create-case-with-online-submission',
  options: {
    validate: {
      ...validateApiKeyHeader(),
      payload: createCasePayloadSchema,
      options: validationOptions,
      failAction: async (h, error) => {
        const { constants: httpConstants } = http2
        const headerError = Array.isArray(error?.details) &&
          error.details.some(d => d?.context?.key === 'x-api-key')

        if (headerError) {
          return h
            .response({ error: 'Missing or invalid QA-specific x-api-key header' })
            .code(httpConstants.HTTP_STATUS_UNAUTHORIZED)
            .takeover()
        }

        return h
          .response({ error: 'Invalid request payload', details: error?.details?.map(d => d.message) })
          .code(httpConstants.HTTP_STATUS_BAD_REQUEST)
          .takeover()
      }
    },
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
