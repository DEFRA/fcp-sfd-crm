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

const { constants: httpConstants } = http2

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
      {
        method: 'POST',
        path: '/create-case',
        options: {
          validate: {
            headers: Joi.object({
              'x-api-key': Joi.string().valid(config.get('apiKeyForTestingCaseCreation')).required()
            }).unknown(),
            failAction: async function (_request, h, error) {
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
          },
          handler: async (request) => {
            const { getCrmAuthToken } = await import('./auth/get-crm-auth-token.js')
            const { createCaseInCrm } = await import('./services/create-case-in-crm.js')
            const authToken = await getCrmAuthToken()
            const caseResult = await createCaseInCrm({ authToken, caseData: request.payload })
            return { caseResult }
          }
        }
      }
    ])
  }

  return server
}

export { createServer }
