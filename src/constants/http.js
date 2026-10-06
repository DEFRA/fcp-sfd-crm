// Shared HTTP status codes. Kept here so the transport layer and the repos
// agree on a single definition rather than each declaring its own.

// Returned by Dataverse when a conditional upsert (If-None-Match) targets a
// record that already exists. This is the designed idempotency signal, not a
// failure.
export const HTTP_PRECONDITION_FAILED = 412
