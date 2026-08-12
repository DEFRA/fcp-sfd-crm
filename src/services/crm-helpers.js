import http2 from 'node:http2'
import Boom from '@hapi/boom'
import { createLogger } from '../logging/logger.js'
import {
  getOnlineSubmissionId,
  getContactIdFromCrn,
  getAccountIdFromSbi
} from '../repos/crm.js'
import { messages } from '../constants/messages.js'
import { sendAuditEvent } from '../messaging/outbound/audit/send-audit-event.js'
import { buildPersonReadEvent, buildBusinessReadEvent } from '../messaging/outbound/audit/build-audit-event.js'
import { auditStatuses, auditFailureReasons } from '../constants/audit.js'

const logger = createLogger()
const { constants: httpConstants } = http2

const MASK_VISIBLE_DIGITS = 4

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

// sendAuditEvent already catches its own errors, but every emission point is
// wrapped again here as a defensive backstop: audit emission must never be
// able to prevent a business error being thrown or a case being created.
const emitAuditEvent = async (event) => {
  try {
    await sendAuditEvent(event)
  } catch (err) {
    logger.error(`Unexpected error emitting audit event: ${err.message}`)
  }
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
export async function ensureContactAndAccount (authToken, crn, sbi, context = {}) {
  const { correlationId } = context
  const { contactId, error: contactError } = await getContactIdFromCrn(authToken, crn)

  if (contactError) {
    if (contactError.retryMetadata?.category === 'retryable') {
      const err = new Error(`Retryable error looking up contact for CRN: ${maskCrn(crn)}`)
      err.retryable = true
      err.retryMetadata = contactError.retryMetadata
      throw err
    }
    logger.error(`No contact found for CRN: ${maskCrn(crn)}, error: ${contactError}`)
    throw unprocessableEntity('Contact ID not found')
  }

  if (!contactId) {
    logger.error(`No contact found for CRN: ${maskCrn(crn)}`)
    await emitAuditEvent(buildPersonReadEvent({
      correlationId,
      crn,
      status: auditStatuses.FAILURE,
      details: { reason: auditFailureReasons.CRN_NOT_FOUND }
    }))
    throw unprocessableEntity('Contact ID not found')
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
    throw unprocessableEntity('Account ID not found')
  }

  if (!accountId) {
    logger.error(`No account found for SBI: ${sbi}`)
    await emitAuditEvent(buildBusinessReadEvent({
      correlationId,
      sbi,
      status: auditStatuses.FAILURE,
      details: { reason: auditFailureReasons.SBI_NOT_FOUND }
    }))
    throw unprocessableEntity('Account ID not found')
  }

  await emitAuditEvent(buildBusinessReadEvent({ correlationId, accountId, sbi }))

  return { contactId, accountId }
}

export async function fetchRpaOnlineSubmissionIdOrThrow (authToken, caseId, context = {}) {
  const { correlationId } = context

  const { rpaOnlinesubmissionid, error } = await getOnlineSubmissionId(authToken, caseId)

  if (error) {
    if (error.retryMetadata?.category === 'retryable') {
      const retryableErr = new Error(messages.SUBMISSION_ID_FAILURE)
      retryableErr.retryable = true
      retryableErr.retryMetadata = error.retryMetadata
      throw retryableErr
    }
    logger.error({ transaction: { id: correlationId }, event: { reference: caseId }, error }, messages.SUBMISSION_ID_FAILURE)
    const err = new Error(messages.SUBMISSION_ID_FAILURE)
    err.retryable = false
    throw err
  }

  if (!rpaOnlinesubmissionid) {
    logger.error({ transaction: { id: correlationId }, event: { reference: caseId } }, 'Online submission id not found')
    const err = new Error(messages.SUBMISSION_ID_FAILURE)
    err.retryable = false
    throw err
  }

  return rpaOnlinesubmissionid
}
