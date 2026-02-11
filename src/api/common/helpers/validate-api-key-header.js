import http2 from 'node:http2'
import Joi from 'joi'
import { config } from '../../../config/index.js'

const { constants: httpConstants } = http2

export const validateApiKeyHeader = () => ({
  headers: Joi.object({
    'x-api-key': Joi.string().valid(config.get('apiKeyForTestingCaseCreation')).required()
  }).unknown(),
  failAction: async (_request, h, error) => {
    const headerError = Array.isArray(error?.details) &&
      error.details.some(d => d?.context?.key === 'x-api-key')
    if (headerError) {
      return h
        .response({ error: 'Missing or invalid QA-specific x-api-key header' })
        .code(httpConstants.HTTP_STATUS_UNAUTHORIZED)
        .takeover()
    }
    return h.continue
  }
})
