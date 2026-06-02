/**
 * Sanitizes a validation error value for logging.
 * - Truncates strings longer than 100 characters
 * - Returns original value for short values
 *
 * @param {*} value - The value to sanitize
 * @returns {*} The sanitized value
 */
const sanitizeValue = (value) => {
  if (typeof value === 'string' && value.length > 100) {
    return value.substring(0, 100)
  }

  return value
}

/**
 * Converts Joi error details path array to dot-notation string.
 * Example: ['data', 'file', 'url'] -> 'data.file.url'
 *
 * @param {Array} pathArray - Array of path segments from Joi error
 * @returns {string} Dot-notated field path
 */
const formatFieldPath = (pathArray) => {
  return pathArray.join('.')
}

/**
 * Logs a message validation failure with structured error information.
 * Uses an Error object so that Pino serialises the details into the
 * error.* namespace which CDP exposes in OpenSearch.
 *
 * @param {object} logger - Pino logger instance
 * @param {object} joiError - Joi ValidationError with details array
 * @param {object} payload - The parsed message payload (used for context only)
 * @param {string} direction - 'inbound' or 'outbound'
 */
export const logValidationFailure = (logger, joiError, payload, direction = 'inbound') => {
  const validationErrors = joiError.details.map((detail) => {
    const field = formatFieldPath(detail.path)

    return {
      field,
      type: detail.type,
      value: sanitizeValue(detail.context?.value),
      message: detail.message
    }
  })

  const failedFields = validationErrors.map(e => e.field).join(', ')
  const label = direction === 'outbound' ? 'Outbound SNS event failed validation' : 'Inbound message failed validation'

  const err = new Error(
    `${label} — ${validationErrors.length} error(s) on [${failedFields}]. ` +
    `Message from '${payload?.source || 'unknown'}' (id: '${payload?.id || 'unknown'}') was discarded.`
  )
  err.validationErrors = validationErrors
  err.source = payload?.source
  err.eventId = payload?.id
  err.eventType = payload?.type

  logger.error(err, label)
}

export const logInboundValidationFailure = (logger, joiError, payload) => {
  logValidationFailure(logger, joiError, payload, 'inbound')
}

export const logOutboundValidationFailure = (logger, joiError, payload) => {
  logValidationFailure(logger, joiError, payload, 'outbound')
}
