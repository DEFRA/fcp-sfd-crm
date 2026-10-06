// Dimension budget for CDP custom metrics (ticket FLS1-187). Only these three keys may be
// attached to a metric call, and each key's value must come from its own fixed set of no
// more than ten values below — this keeps CloudWatch metric cardinality bounded and stops
// caller-controlled identifiers (correlationId, fileId, CRN, SBI) ending up as dimension data.
export const ALLOWED_METRIC_DIMENSION_KEYS = Object.freeze(['reason', 'route', 'outcome'])

// Per-key value allow-lists backing ALLOWED_METRIC_DIMENSION_KEYS. 'outcome' mirrors the
// values already used for this field across this service's structured logs (case.js,
// http/client.js, messaging/inbound/consumer.js, etc). 'reason' and 'route' are a starter
// set for the first call sites to use these dimensions; extend deliberately, keeping each
// list at 10 values or fewer.
export const ALLOWED_METRIC_DIMENSION_VALUES = Object.freeze({
  outcome: Object.freeze(['success', 'failure', 'unknown']),
  reason: Object.freeze([
    'validation_failure',
    'timeout',
    'unexpected_error',
    'rate_limited',
    'not_found',
    'conflict',
    'unauthorized',
    'dependency_unavailable'
  ]),
  route: Object.freeze([
    'callback',
    'initiate',
    'status',
    'case_creation'
  ])
})
