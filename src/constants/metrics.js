// Dimension budget for CDP custom metrics (ticket FLS1-187). Only these keys may be attached
// to a metric call, and each key's value must come from its own fixed set of no more than ten
// values below. This keeps CloudWatch metric cardinality bounded and stops caller-controlled
// identifiers (correlationId, fileId, CRN, SBI) ending up as dimension data.
//
// 'route' is deliberately absent. This service registers no HTTP routes (the server exists
// only to host the platform plugins), so the key could never carry a real value here, and a
// raw request path is exactly the unbounded-cardinality dimension the budget exists to keep
// out. Add it back only alongside a set of templated route identifiers to validate against.
export const ALLOWED_METRIC_DIMENSION_KEYS = Object.freeze(['reason', 'outcome'])

// Per-key value allow-lists backing ALLOWED_METRIC_DIMENSION_KEYS. Extend deliberately,
// keeping each list at 10 values or fewer.
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
  ])
})
