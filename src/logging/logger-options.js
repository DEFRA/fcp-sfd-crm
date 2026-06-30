import { ecsFormat } from '@elastic/ecs-pino-format'
import { config } from '../config/index.js'
import { getTraceId } from '@defra/hapi-tracing'

const logConfig = config.get('log') ?? {}
const serviceName = config.get('serviceName')
const serviceVersion = config.get('serviceVersion')

const logEnabled = logConfig.isEnabled ?? true
const logRedact = Array.isArray(logConfig.redact) ? logConfig.redact : []
const logLevel = logConfig.level ?? 'info'
const logFormat = logConfig.format ?? 'ecs'

const formatters = {
  ecs: {
    ...ecsFormat({
      serviceVersion,
      serviceName
    })
  },
  'pino-pretty': { transport: { target: 'pino-pretty' } }
}

export const loggerOptions = {
  enabled: logEnabled,
  ignorePaths: ['/health'],
  redact: {
    paths: logRedact,
    remove: true
  },
  level: logLevel,
  ...(formatters[logFormat]),
  nesting: true,
  mixin: () => {
    const traceId = getTraceId()
    if (traceId) {
      return { trace: { id: traceId } }
    }
    return {}
  }
}
