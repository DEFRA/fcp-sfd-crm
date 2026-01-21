import path from 'node:path'
import hapi from '@hapi/hapi'
import http2 from 'node:http2'
import Joi from 'joi'
import { config } from './config/index.js'
import { requestLogger } from './logging/request-logger.js'
import { secureContext } from './api/common/helpers/secure-context/secure-context.js'
import { pulse } from './api/common/helpers/pulse.js'
import { requestTracing } from './api/common/helpers/request-tracing.js'
import { setupProxy } from './api/common/helpers/proxy/setup-proxy.js'
import { getCrmAuthToken } from './auth/get-crm-auth-token.js'
import { createCaseInCrm } from './services/create-case-in-crm.js'
import { createCaseWithOnlineSubmissionInCrm } from './services/create-case-with-online-submission-in-crm.js'

const { constants: httpConstants } = http2

const validateApiKeyHeader = () => ({
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

const postCreateCase = () => ({
  method: 'POST',
  path: '/create-case',
  options: {
    validate: validateApiKeyHeader(),
    handler: async (request) => {
      const authToken = await getCrmAuthToken()
      const caseResult = await createCaseInCrm({ authToken, ...request.payload })
      return { caseResult }
    }
  }
})

const postCreateCaseWithOnlineSubmission = () => ({
  method: 'POST',
  path: '/create-case-with-online-submission',
  options: {
    validate: validateApiKeyHeader(),
    handler: async (request) => {
      const authToken = await getCrmAuthToken()
      const caseResult = await createCaseWithOnlineSubmissionInCrm({ authToken, ...request.payload })
      return { caseResult }
    }
  }
})

const createServer = async () => {
  setupProxy()

  const server = hapi.server({
    port: config.get('port'),
    routes: {
      validate: {
        options: {
          abortEarly: false
        }
      },
      files: {
        relativeTo: path.resolve(config.get('root'), '.public')
      },
      security: {
        hsts: {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: false
        },
        xss: 'enabled',
        noSniff: true,
        xframe: true
      }
    },
    router: {
      stripTrailingSlash: true
    }
  })

  await server.register([
    requestLogger,
    requestTracing,
    secureContext,
    pulse
  ])

  if (config.get('cdpEnvironment') !== 'prod') {
    server.route([
      postCreateCase(),
      postCreateCaseWithOnlineSubmission()
    ])
  }

  return server
}

export { createServer }
