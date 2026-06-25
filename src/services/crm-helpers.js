import http2 from 'node:http2'
import Boom from '@hapi/boom'
import { createLogger } from '../logging/logger.js'
import { sendAuditEvent } from '../messaging/outbound/audit/send-audit-event.js'
import {
  getOnlineSubmissionId,
  getContactIdFromCrn,
  getAccountIdFromSbi
} from '../repos/crm.js'
import { messages } from '../constants/messages.js'

const logger = createLogger()
const { constants: httpConstants } = http2

const unprocessableEntity = (message) => {
  const error = new Error(message)
  return Boom.boomify(error, { statusCode: httpConstants.HTTP_STATUS_UNPROCESSABLE_ENTITY })
}

const isRetryableLookupError = (error) => error?.retryMetadata?.category === 'retryable'

const throwRetryableLookupError = (message, retryMetadata) => {
  const err = new Error(message)
  err.retryable = true
  err.retryMetadata = retryMetadata
  throw err
}

const getAuditFailureReason = (err) =>
  String(err?.message || '').toLowerCase().includes('schema') ? 'schema' : 'transport'

const logAuditPublishFailed = (type, correlationId, err) => {
  const reason = getAuditFailureReason(err)
  logger.error({ event: { type, reference: correlationId ?? null, reason } }, 'audit_publish_failed')
}

const sendAuditEventSafely = async (payload, type, correlationId) => {
  try {
    await sendAuditEvent(payload)
  } catch (err) {
    logAuditPublishFailed(type, correlationId, err)
  }
}

const sendAuditEventAsync = (payload, type, correlationId) => {
  setImmediate(() => {
    sendAuditEvent(payload).catch(err => {
      logAuditPublishFailed(type, correlationId, err)
    })
  })
}

const handleLookupError = ({ error, retryMessage, lookupLogMessage, notFoundMessage }) => {
  if (isRetryableLookupError(error)) {
    throwRetryableLookupError(retryMessage, error.retryMetadata)
  }

  logger.error(lookupLogMessage)
  throw unprocessableEntity(notFoundMessage)
}

const handleNotFound = async ({
  correlationId,
  auditPayload,
  auditType,
  lookupLogMessage,
  notFoundMessage
}) => {
  await sendAuditEventSafely(auditPayload, auditType, correlationId)
  logger.error(lookupLogMessage)
  throw unprocessableEntity(notFoundMessage)
}

export function assertRequiredParams(requiredParams) {
  for (const [param, value] of Object.entries(requiredParams)) {
    const errorMessage = `Missing required parameter: ${param}`

    if (value === null || value === undefined) {
      logger.error(errorMessage)
      throw Boom.badRequest(errorMessage)
    }
  }
}

export async function ensureContactAndAccount(authToken, crn, sbi, correlationId) {
  const { contactId, error: contactError } = await getContactIdFromCrn(authToken, crn, { correlationId })

  if (contactError) {
    handleLookupError({
      error: contactError,
      retryMessage: `Retryable error looking up contact for CRN: ${crn}`,
      lookupLogMessage: `No contact found for CRN: ${crn}, error: ${contactError}`,
      notFoundMessage: 'Contact ID not found'
    })
  }

  if (!contactId) {
    await handleNotFound({
      correlationId,
      auditPayload: {
        correlationId,
        accounts: { crn, sbi },
        audit: { status: 'failure', details: 'CRN not found' }
      },
      auditType: 'uk.gov.fcp.sfd.person.read',
      lookupLogMessage: `No contact found for CRN: ${crn}`,
      notFoundMessage: 'Contact ID not found'
    })
  }

  sendAuditEventAsync(
    {
      correlationId,
      contactId,
      accounts: { crn, sbi }
    },
    'uk.gov.fcp.sfd.person.read',
    correlationId
  )

  const { accountId, error: accountError } = await getAccountIdFromSbi(authToken, sbi, { correlationId })

  if (accountError) {
    handleLookupError({
      error: accountError,
      retryMessage: `Retryable error looking up account for SBI: ${sbi}`,
      lookupLogMessage: `No account found for SBI: ${sbi}, error: ${accountError}`,
      notFoundMessage: 'Account ID not found'
    })
  }

  if (!accountId) {
    await handleNotFound({
      correlationId,
      auditPayload: {
        correlationId,
        accounts: { sbi },
        audit: { status: 'failure', details: 'SBI not found' }
      },
      auditType: 'uk.gov.fcp.sfd.business.read',
      lookupLogMessage: `No account found for SBI: ${sbi}`,
      notFoundMessage: 'Account ID not found'
    })
  }

  sendAuditEventAsync(
    {
      correlationId,
      accountId,
      accounts: { sbi }
    },
    'uk.gov.fcp.sfd.business.read',
    correlationId
  )

  return { contactId, accountId }
}

export async function fetchRpaOnlineSubmissionIdOrThrow(authToken, caseId, context = {}) {
  const { correlationId } = context

  const { rpaOnlinesubmissionid, error } = await getOnlineSubmissionId(authToken, caseId)

  if (error) {
    if (error.retryMetadata?.category === 'retryable') {
      const retryableErr = new Error(messages.SUBMISSION_ID_FAILURE)
      retryableErr.retryable = true
      retryableErr.retryMetadata = error.retryMetadata
      throw retryableErr
    }
    logger.error({ correlationId, caseId, error }, messages.SUBMISSION_ID_FAILURE)
    const err = new Error(messages.SUBMISSION_ID_FAILURE)
    err.retryable = false
    throw err
  }

  if (!rpaOnlinesubmissionid) {
    logger.error({ correlationId, caseId }, 'Online submission id not found')
    const err = new Error(messages.SUBMISSION_ID_FAILURE)
    err.retryable = false
    throw err
  }

  return rpaOnlinesubmissionid
}
