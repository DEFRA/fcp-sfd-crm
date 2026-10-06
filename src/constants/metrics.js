// §3.2 dimension budget: any other key is stripped before it reaches CloudWatch.
export const ALLOWED_METRIC_DIMENSION_KEYS = Object.freeze(['reason', 'route', 'outcome'])
