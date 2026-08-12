import http2 from 'node:http2'
import Boom from '@hapi/boom'
import { createLogger } from '../logging/logger.js'
import {
  getOnlineSubmissionActivityId,
  getContactIdFromCrn,
  getAccountIdFromSbi
} from '../repos/crm.js'
import { messages } from '../constants/messages.js'
import { emitAuditEvent } from '../messaging/outbound/audit/send-audit-event.js'
import { buildPersonReadEvent, buildBusinessReadEvent } from '../messaging/outbound/audit/build-audit-event.js'
import { auditStatuses, auditFailureReasons } from '../constants/audit.js'

const logger = createLogger()
const { constants: httpConstants } = http2

const MASK_VISIBLE_DIGITS = 4

// Generic identifier masker: safe for CRN, SBI or any other numeric/text
// identifier where only the last few digits should be logged. For a sole
// trader the SBI is effectively a personal identifier, so it is masked on
// the same terms as the CRN.
export function maskIdentifier (identifier) {
  if (identifier === null || identifier === undefined) { return '****' }
  const str = String(identifier)
  if (str.length <= MASK_VISIBLE_DIGITS) { return str }
  return '*'.repeat(str.length - MASK_VISIBLE_DIGITS) + str.slice(-MASK_VISIBLE_DIGITS)
}

const unprocessableEntity = (message) => {
  const error = new Error(message)
  return Boom.boomify(error, { statusCode: httpConstants.HTTP_STATUS_UNPROCESSABLE_ENTITY })
}

export function assertRequiredParams (requiredParams) {
  for (const [param, value] of Object.entries(requiredParams)) {
    const errorMessage = `Missing required parameter: ${param}`

    if (value === null || value === undefined) {
      logger.error(errorMessage)
      throw Boom.badRequest(errorMessage)
    }
  }
}

const CONTACT_NOT_FOUND = 'Contact ID not found'
const ACCOUNT_NOT_FOUND = 'Account ID not found'

/**
 * Handle a failed CRM identity lookup. A retryable CRM failure is rethrown as
 * retryable so the message stays on the queue; anything else is terminal and
 * becomes a 422. Shared by the contact and account lookups, which differ only
 * in the nouns they use.
 * @param {object} params
 * @param {object} params.error - error returned by the repo
 * @param {string} params.correlationId
 * @param {string} params.subject - "contact" or "account"
 * @param {string} params.identifierLabel - "CRN" or "SBI"
 * @param {string} params.masked - the masked identifier, safe to log
 * @param {string} params.notFoundMessage - message for the 422
 * @throws always
 */
const throwLookupFailure = ({ error, correlationId, subject, identifierLabel, masked, notFoundMessage }) => {
  if (error.retryMetadata?.category === 'retryable') {
    const retryableErr = new Error(`Retryable error looking up ${subject} for ${identifierLabel}: ${masked}`)
    retryableErr.retryable = true
    retryableErr.retryMetadata = error.retryMetadata
    throw retryableErr
  }

  // Only the error classification is logged. The raw repo error can carry a
  // CRM API response body containing PII.
  logger.error({
    transaction: { id: correlationId },
    error: { type: error.name ?? 'CrmLookupError', status: error.retryMetadata?.status ?? null }
  }, `No ${subject} found for ${identifierLabel}: ${masked}`)

  throw unprocessableEntity(notFoundMessage)
}

/**
 * Record a lookup that found no match: the not-found audit event is emitted
 * before the business error is thrown, and emission can never prevent it.
 * @param {object} params
 * @param {object} params.event - built audit event
 * @param {string} params.correlationId
 * @param {string} params.subject - "contact" or "account"
 * @param {string} params.identifierLabel - "CRN" or "SBI"
 * @param {string} params.masked - the masked identifier, safe to log
 * @param {string} params.notFoundMessage - message for the 422
 * @throws always
 */
const throwNotFound = async ({ event, correlationId, subject, identifierLabel, masked, notFoundMessage }) => {
  logger.error({ transaction: { id: correlationId } }, `No ${subject} found for ${identifierLabel}: ${masked}`)
  await emitAuditEvent(event)
  throw unprocessableEntity(notFoundMessage)
}

/**
 * Resolve the CRM contact and account for a farmer, looking up by CRN and
 * SBI respectively. Emits person/read and business/read audit events per
 * the FLS1-21 spike table: success events on resolution, failure events
 * (status: "failure") when a lookup returns no match. Every emission is
 * wrapped so a failure to audit can never prevent the business error below
 * from being thrown as normal, nor affect message processing outcome.
 * @param {string} authToken - CRM bearer token
 * @param {string|number} crn - Customer Reference Number for the farmer
 * @param {string|number} sbi - Single Business Identifier for the farm
 * @param {{ correlationId?: string }} [context] - inbound CloudEvents correlationId, for audit traceability
 * @returns {Promise<{ contactId: string, accountId: string }>}
 */
export async function ensureContactAndAccount (authToken, crn, sbi, { correlationId } = {}) {
  if (!correlationId) {
    // Not fatal - lookups still proceed - but every event emitted for this
    // call will fail correlationid schema validation and be dropped, so
    // this is surfaced loudly rather than silently defaulting.
    logger.warn({
      event: {
        type: 'error',
        action: 'audit_correlation_id_missing',
        category: 'process',
        outcome: 'failure',
        reason: 'missing_correlation_id'
      }
    }, 'ensureContactAndAccount called without a correlationId: person/read and business/read audit events for this call will fail schema validation')
  }

  const { contactId, error: contactError } = await getContactIdFromCrn(authToken, crn)

  const contact = { subject: 'contact', identifierLabel: 'CRN', masked: maskIdentifier(crn), notFoundMessage: CONTACT_NOT_FOUND }

  if (contactError) {
    throwLookupFailure({ error: contactError, correlationId, ...contact })
  }

  if (!contactId) {
    await throwNotFound({
      event: buildPersonReadEvent({
        correlationId,
        crn,
        status: auditStatuses.FAILURE,
        details: { reason: auditFailureReasons.CRN_NOT_FOUND }
      }),
      correlationId,
      ...contact
    })
  }

  await emitAuditEvent(buildPersonReadEvent({ correlationId, contactId, crn }))

  const { accountId, error: accountError } = await getAccountIdFromSbi(authToken, sbi)

  const account = { subject: 'account', identifierLabel: 'SBI', masked: maskIdentifier(sbi), notFoundMessage: ACCOUNT_NOT_FOUND }

  if (accountError) {
    throwLookupFailure({ error: accountError, correlationId, ...account })
  }

  if (!accountId) {
    await throwNotFound({
      event: buildBusinessReadEvent({
        correlationId,
        sbi,
        status: auditStatuses.FAILURE,
        details: { reason: auditFailureReasons.SBI_NOT_FOUND }
      }),
      correlationId,
      ...account
    })
  }

  await emitAuditEvent(buildBusinessReadEvent({ correlationId, accountId, sbi }))

  return { contactId, accountId }
}

export async function fetchOnlineSubmissionActivityIdOrThrow (authToken, caseId, { fileId } = {}) {
  const { onlineSubmissionActivityId, error } = await getOnlineSubmissionActivityId(authToken, caseId)

  if (error) {
    if (error.retryMetadata?.category === 'retryable') {
      const retryableErr = new Error(messages.SUBMISSION_ID_FAILURE)
      retryableErr.retryable = true
      retryableErr.retryMetadata = error.retryMetadata
      throw retryableErr
    }
    logger.error({
      error,
      event: {
        reference: caseId,
        category: error.retryMetadata?.category ?? 'online_submission_lookup_failed',
        reason: error.crmError ?? error.message
      },
      fileId
    }, messages.SUBMISSION_ID_FAILURE)
    const err = new Error(messages.SUBMISSION_ID_FAILURE)
    err.retryable = false
    err.retryMetadata = error.retryMetadata ?? null
    throw err
  }

  if (!onlineSubmissionActivityId) {
    // The online submission is created in the same request as the case, but is
    // not always immediately queryable afterwards. A miss here is ordinarily
    // that transient window rather than a genuine absence, so it is retried up
    // to the queue's receive limit instead of going straight to the DLQ.
    logger.warn({
      event: { reference: caseId, category: 'retryable', reason: 'online_submission_not_yet_queryable' },
      fileId
    }, 'Online submission not yet queryable, will retry')
    const err = new Error(messages.SUBMISSION_ID_FAILURE)
    err.retryable = true
    err.retryMetadata = { category: 'retryable', terminalReason: 'online_submission_not_yet_queryable' }
    throw err
  }

  return onlineSubmissionActivityId
}
