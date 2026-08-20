/**
 * Whether a failure ends this message's life: the consumer will dead-letter it
 * rather than leave it on the queue for another delivery.
 *
 * Errors that never set the flag are terminal — a Boom 400 from
 * assertRequiredParams or a Boom 422 from ensureContactAndAccount reach the
 * consumer with no `retryable` property at all, and are discarded.
 *
 * Anything deciding what to do before a message dead-letters must ask this
 * rather than re-testing the flag, so that the queue's behaviour and the
 * service's clean-up can never disagree about which failures are final.
 */
export const isTerminalFailure = (err) => !err?.retryable
