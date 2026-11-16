import { dlqRoutingReasons } from './dlq-routing.js'

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

// Per-key value allow-lists backing ALLOWED_METRIC_DIMENSION_KEYS. Each value must be one a
// CRM code path emits or is about to emit, and each list holds 10 values or fewer.
// - 'reason': the DLQ routing reasons sent with crm.dlq.routed by the inbound consumer.
// - 'outcome': the crm.message.processed outcomes planned in the CRM throughput metrics
//   ticket (success, retried, routed_to_dlq, dlq_send_failed, error).
export const ALLOWED_METRIC_DIMENSION_VALUES = Object.freeze({
  outcome: Object.freeze(['success', 'retried', 'routed_to_dlq', 'dlq_send_failed', 'error']),
  reason: Object.freeze(Object.values(dlqRoutingReasons))
})
