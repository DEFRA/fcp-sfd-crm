import { Metrics } from '@defra/cdp-metrics'

import { config } from '../../../config/index.js'
import { createLogger } from '../../../logging/logger.js'
import { ALLOWED_METRIC_DIMENSION_KEYS } from '../../../constants/metrics.js'

const logger = createLogger()
const metrics = new Metrics(logger)

// Strips any dimension outside the §3.2 budget; only the key is logged so a caller-controlled
// value (e.g. fileId, correlationId) never ends up in a log line.
const sanitiseDimensions = (dimensions = {}) => {
  return Object.keys(dimensions).reduce((allowed, key) => {
    if (!ALLOWED_METRIC_DIMENSION_KEYS.includes(key)) {
      logger.warn(`Dropping unsupported metric dimension key: ${key}`)
      return allowed
    }

    allowed[key] = dimensions[key]
    return allowed
  }, {})
}

const isMetricsEnabled = () => config.get('isMetricsEnabled')

const metricsCounter = (metricName, value = 1, dimensions = {}) => {
  if (!isMetricsEnabled()) {
    return undefined
  }

  return metrics.counter(metricName, value, sanitiseDimensions(dimensions))
}

const metricsGauge = (metricName, value, dimensions = {}) => {
  if (!isMetricsEnabled()) {
    return undefined
  }

  return metrics.gauge(metricName, value, sanitiseDimensions(dimensions))
}

const metricsMillis = (metricName, value, dimensions = {}) => {
  if (!isMetricsEnabled()) {
    return undefined
  }

  return metrics.millis(metricName, value, sanitiseDimensions(dimensions))
}

export { metricsCounter, metricsGauge, metricsMillis }
