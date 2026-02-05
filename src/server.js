import path from 'node:path'
import hapi from '@hapi/hapi'
import { config } from './config/index.js'
import { requestLogger } from './logging/request-logger.js'
import { secureContext } from './api/common/helpers/secure-context/secure-context.js'
import { pulse } from './api/common/helpers/pulse.js'
import { requestTracing } from './api/common/helpers/request-tracing.js'
import { setupProxy } from './api/common/helpers/proxy/setup-proxy.js'
import { postCreateCaseWithOnlineSubmission } from './routes/create-case-with-online-submission.js'

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
      postCreateCaseWithOnlineSubmission()
    ])
  }

  return server
}

export { createServer }
