import path from 'node:path'
import hapi from '@hapi/hapi'

import { config } from './config/index.js'
import { requestLogger } from './logging/request-logger.js'
import { secureContext } from './api/common/helpers/secure-context/secure-context.js'
import { pulse } from './api/common/helpers/pulse.js'
import { requestTracing } from './api/common/helpers/request-tracing.js'
import { setupProxy } from './api/common/helpers/proxy/setup-proxy.js'

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
          handler: async (request, h) => {
            const apiKey = request.headers['x-api-key']
            const expectedApiKey = config.get('apiKey')
            if (!apiKey || apiKey !== expectedApiKey) {
              return h.response({ error: 'Invalid or missing API key' }).code(401)
            }
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
