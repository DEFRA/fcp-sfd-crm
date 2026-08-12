import http2 from 'node:http2'
import crypto from 'node:crypto'

import { getTraceId } from '@defra/hapi-tracing'
import { getCrmAuthToken } from '../auth/get-crm-auth-token.js'
import { validateApiKeyHeader } from '../api/common/helpers/validate-api-key-header.js'
import { createCaseWithOnlineSubmissionInCrm } from '../services/create-case-with-online-submission-in-crm.js'
import { createCasePayloadSchema, validationOptions } from '../api/schemas/index.js'
import { emitAuditEvent } from '../messaging/outbound/audit/send-audit-event.js'
import { buildCredentialFailureEvent } from '../messaging/outbound/audit/build-audit-event.js'

// request.info.id is unsuitable as a correlationId: Hapi builds it as
// `${received}:${hostname}:${pid}:${counter}`, which regularly exceeds the
// audit schema's 50-character correlationid cap once a realistic pod
// hostname is included (e.g. "fcp-sfd-crm-b7d9f8c6d4-x2k9p" already produces
// a 59-character id). getTraceId() returns the inbound x-cdp-request-id
// header when present (already registered by the requestTracing plugin in
// server.js); a fresh UUID is used otherwise, which also fits comfortably
// within the schema limit. Used for both the audit correlationId here and
// the business correlationId passed to the service layer, so every audit
// event emitted from this route - not just the row 7 security event -
// shares one valid correlation id.
const resolveCorrelationId = () => getTraceId() ?? crypto.randomUUID()

export const postCreateCaseWithOnlineSubmission = () => ({
  method: 'POST',
  path: '/create-case-with-online-submission',
  options: {
    validate: {
      ...validateApiKeyHeader(),
      payload: createCasePayloadSchema,
      options: validationOptions,
      failAction: async (request, h, error) => {
        const { constants: httpConstants } = http2
        const headerError = Array.isArray(error?.details) &&
          error.details.some(d => d?.context?.key === 'x-api-key')

        if (headerError) {
          // Row 7 of the spike table: invalid or missing credentials is a
          // possible intrusion attempt, so it is audited even though it
          // never reaches the service layer.
          await emitAuditEvent(buildCredentialFailureEvent({
            correlationId: resolveCorrelationId(),
            reason: 'Missing or invalid QA-specific x-api-key header'
          }))

          return h
            .response({ error: 'Missing or invalid QA-specific x-api-key header' })
            .code(httpConstants.HTTP_STATUS_UNAUTHORIZED)
            .takeover()
        }

        return h
          .response({ error: 'Invalid request payload', details: error?.details?.map(d => d.message) })
          .code(httpConstants.HTTP_STATUS_BAD_REQUEST)
          .takeover()
      }
    },
    handler: async (request) => {
      const authToken = await getCrmAuthToken()
      const { caseType, ...crmPayload } = request.payload
      const correlationId = resolveCorrelationId()
      const caseResult = await createCaseWithOnlineSubmissionInCrm({
        authToken,
        correlationId,
        caseType,
        ...crmPayload
      })

      return { caseResult }
    }
  }
})
