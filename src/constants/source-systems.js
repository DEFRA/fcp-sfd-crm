// Source systems whose value may appear as sourceSystem=<value> in tenant.message.
//
// The object processor holds the same list as SERVICE_EXAMPLES in its
// src/constants/schemas.js. A new source system must be added to both lists, or
// this service will process its messages but omit the pair from its log lines.
export const ALLOWED_SOURCE_SYSTEMS = Object.freeze(['fcp-sfd-frontend', 'rps-portal'])
