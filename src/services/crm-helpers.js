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
import { triageFailureReasons } from '../constants/integration-inbound-triage.js'

const logger = createLogger()
const { constants: httpConstants } = http2

const MASK_VISIBLE_DIGITS = 4

// Generic identifier masker: safe for CRN, SBI or any other numeric/text
// identifier where only the last few digits should be logged.
export function maskCrn (crn) {
  if (crn === null || crn === undefined) { return '****' }
  const str = String(crn)
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
    logger.warn('ensureContactAndAccount called without a correlationId: person/read and business/read audit events for this call will fail schema validation')
  }

  const { contactId, error: contactError } = await getContactIdFromCrn(authToken, crn)

  if (contactError) {
    if (contactError.retryMetadata?.category === 'retryable') {
      const err = new Error(`Retryable error looking up contact for CRN: ${maskCrn(crn)}`)
      err.retryable = true
      err.retryMetadata = contactError.retryMetadata
      throw err
    }
    logger.error(`No contact found for CRN: ${maskCrn(crn)}, error: ${contactError}`)
    const err = unprocessableEntity('Contact ID not found')
    err.triageFailureReason = triageFailureReasons.CONTACT_NOT_FOUND_FOR_CRN
    throw err
  }

  if (!contactId) {
    logger.error(`No contact found for CRN: ${maskCrn(crn)}`)
    await emitAuditEvent(buildPersonReadEvent({
      correlationId,
      crn,
      status: auditStatuses.FAILURE,
      details: { reason: auditFailureReasons.CRN_NOT_FOUND }
    }))
    const err = unprocessableEntity('Contact ID not found')
    err.triageFailureReason = triageFailureReasons.CONTACT_NOT_FOUND_FOR_CRN
    throw err
  }

  await emitAuditEvent(buildPersonReadEvent({ correlationId, contactId, crn }))

  const { accountId, error: accountError } = await getAccountIdFromSbi(authToken, sbi)

  if (accountError) {
    if (accountError.retryMetadata?.category === 'retryable') {
      const err = new Error(`Retryable error looking up account for SBI: ${sbi}`)
      err.retryable = true
      err.retryMetadata = accountError.retryMetadata
      throw err
    }
    logger.error(`No account found for SBI: ${sbi}, error: ${accountError}`)
    const err = unprocessableEntity('Account ID not found')
    err.triageFailureReason = triageFailureReasons.ACCOUNT_NOT_FOUND_FOR_SBI
    throw err
  }

  if (!accountId) {
    logger.error(`No account found for SBI: ${sbi}`)
    await emitAuditEvent(buildBusinessReadEvent({
      correlationId,
      sbi,
      status: auditStatuses.FAILURE,
      details: { reason: auditFailureReasons.SBI_NOT_FOUND }
    }))
    const err = unprocessableEntity('Account ID not found')
    err.triageFailureReason = triageFailureReasons.ACCOUNT_NOT_FOUND_FOR_SBI
    throw err
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
