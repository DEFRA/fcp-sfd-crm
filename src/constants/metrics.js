// §3.2 dimension budget: any other key is stripped before it reaches CloudWatch.
//
// 'route' is deliberately absent. This service registers no HTTP routes — the
// server exists only to host the platform plugins — so the key could never carry
// a real value here, and a raw request path is exactly the unbounded-cardinality
// dimension the budget exists to keep out. Add it back only alongside a set of
// templated route identifiers to validate against.
export const ALLOWED_METRIC_DIMENSION_KEYS = Object.freeze(['reason', 'outcome'])
