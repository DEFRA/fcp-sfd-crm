import { Metrics } from '@defra/cdp-metrics'

import { config } from '../../../config/index.js'
import { createLogger } from '../../../logging/logger.js'
import { ALLOWED_METRIC_DIMENSION_KEYS, ALLOWED_METRIC_DIMENSION_VALUES } from '../../../constants/metrics.js'

const logger = createLogger()
const metrics = new Metrics(logger)

// Strips any dimension outside the FLS1-187 budget: an unrecognised key is dropped outright,
// and a recognised key with a value outside its allow-list is dropped too — only the key is
// ever logged, never the value, so a caller-controlled value (fileId, correlationId, CRN,
// SBI) never ends up in a log line. Treats null/non-object input the same as {} since default
// parameters do not apply to an explicitly passed null.
const sanitiseDimensions = (dimensions) => {
  const source = dimensions && typeof dimensions === 'object' ? dimensions : {}

  return Object.keys(source).reduce((allowed, key) => {
    if (!ALLOWED_METRIC_DIMENSION_KEYS.includes(key)) {
      logger.warn(`Dropping unsupported metric dimension key: ${key}`)
      return allowed
    }

    if (!ALLOWED_METRIC_DIMENSION_VALUES[key].includes(source[key])) {
      logger.warn(`Dropping unsupported metric dimension value for key: ${key}`)
      return allowed
    }

    allowed[key] = source[key]
    return allowed
  }, {})
}

const isMetricsEnabled = () => config.get('isMetricsEnabled')

// Emits a metric via the given library method, never throwing or rejecting to the caller:
// a metrics failure must not replace or mask whatever the caller was already doing (e.g. the
// case-creation error handling in case.js's role-release path).
const emit = async (method, metricName, value, dimensions) => {
  if (!isMetricsEnabled()) {
    return undefined
  }

  try {
    await method(metricName, value, sanitiseDimensions(dimensions))
  } catch (error) {
    logger.warn(error, error.message)
  }

  return undefined
}

/**
 * Sends a count metric. No-ops when metrics are disabled, and never throws or rejects.
 * @param {string} metricName - The metric name.
 * @param {number} [value=1] - The count value.
 * @param {Record<string, string>} [dimensions={}] - Optional dimensions; only `reason`,
 *   `route` and `outcome` keys are honoured, each restricted to its own allowed value set
 *   (see ALLOWED_METRIC_DIMENSION_VALUES in src/constants/metrics.js). Anything else is
 *   dropped and a warning is logged naming the key only.
 * @returns {Promise<void>}
 */
const metricsCounter = (metricName, value = 1, dimensions = {}) => {
  return emit((...args) => metrics.counter(...args), metricName, value, dimensions)
}

/**
 * Sends a gauge metric (unitless point-in-time value). No-ops when metrics are disabled,
 * and never throws or rejects.
 * @param {string} metricName - The metric name.
 * @param {number} value - The gauge value.
 * @param {Record<string, string>} [dimensions={}] - See metricsCounter for the dimension rules.
 * @returns {Promise<void>}
 */
const metricsGauge = (metricName, value, dimensions = {}) => {
  return emit((...args) => metrics.gauge(...args), metricName, value, dimensions)
}

/**
 * Sends a duration metric in milliseconds. No-ops when metrics are disabled, and never
 * throws or rejects.
 * @param {string} metricName - The metric name.
 * @param {number} value - The duration in milliseconds.
 * @param {Record<string, string>} [dimensions={}] - See metricsCounter for the dimension rules.
 * @returns {Promise<void>}
 */
const metricsMillis = (metricName, value, dimensions = {}) => {
  return emit((...args) => metrics.millis(...args), metricName, value, dimensions)
}

export { metricsCounter, metricsGauge, metricsMillis }
