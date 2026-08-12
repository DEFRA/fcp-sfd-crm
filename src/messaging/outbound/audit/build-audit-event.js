import {
  auditEntities,
  auditActions,
  auditStatuses
} from '../../../constants/audit.js'

/**
 * Coerce an identifier to a string, or return an empty string for the
 * not-found cases (rows 5 and 6 of the spike table have no entity id).
 * @param {string|number|null|undefined} id
 * @returns {string}
 */
const toEntityId = (id) => (id === null || id === undefined ? '' : String(id))

/**
 * Build the accounts object for an audit event, omitting keys that were not
 * supplied so the publisher's defaults are used instead.
 * @param {{ crn?: string|number, sbi?: string|number }} params
 * @returns {object}
 */
const buildAccounts = ({ crn, sbi }) => {
  const accounts = {}
  if (crn !== undefined && crn !== null) {
    accounts.crn = String(crn)
  }
  if (sbi !== undefined && sbi !== null) {
    accounts.sbi = String(sbi)
  }
  return accounts
}

const buildAuditEnvelope = ({ correlationId, entity, action, entityId, crn, sbi, status, details }) => ({
  correlationid: correlationId,
  audit: {
    entities: [{ entity, action, entityid: toEntityId(entityId) }],
    accounts: buildAccounts({ crn, sbi }),
    status,
    details: details ?? {}
  }
})

/**
 * Event 1 (case creation) and event 2 (document attachment) from the spike
 * table: `document/created`, carrying the CRM caseId or metadataId.
 * @param {{ correlationId: string, entityId: string|number, crn?: string|number, sbi?: string|number, details?: object }} params
 * @returns {object} audit event payload for publishAuditEvent
 */
export const buildDocumentCreatedEvent = ({ correlationId, entityId, crn, sbi, details }) =>
  buildAuditEnvelope({
    correlationId,
    entity: auditEntities.DOCUMENT,
    action: auditActions.CREATED,
    entityId,
    crn,
    sbi,
    status: auditStatuses.SUCCESS,
    details
  })

/**
 * Event 3 (contact resolved) and event 5 (CRN not found) from the spike
 * table: `person/read`.
 * @param {{ correlationId: string, contactId?: string|number, crn?: string|number, status?: string, details?: object }} params
 * @returns {object} audit event payload for publishAuditEvent
 */
export const buildPersonReadEvent = ({ correlationId, contactId, crn, status = auditStatuses.SUCCESS, details }) =>
  buildAuditEnvelope({
    correlationId,
    entity: auditEntities.PERSON,
    action: auditActions.READ,
    entityId: contactId,
    crn,
    status,
    details
  })

/**
 * Event 4 (account resolved) and event 6 (SBI not found) from the spike
 * table: `business/read`.
 * @param {{ correlationId: string, accountId?: string|number, sbi?: string|number, status?: string, details?: object }} params
 * @returns {object} audit event payload for publishAuditEvent
 */
export const buildBusinessReadEvent = ({ correlationId, accountId, sbi, status = auditStatuses.SUCCESS, details }) =>
  buildAuditEnvelope({
    correlationId,
    entity: auditEntities.BUSINESS,
    action: auditActions.READ,
    entityId: accountId,
    sbi,
    status,
    details
  })

// Placeholder pmccode for the security event, pending agreement with the fcp-audit team (see FLS1-50 decision 4).
const CREDENTIAL_FAILURE_PMCCODE = 'AUTH'

/**
 * Event 7 (invalid or missing credentials) from the spike table. Carries
 * both `security` and `audit` objects so SOC can query it in MongoDB.
 * @param {{ correlationId: string, reason: string }} params
 * @returns {object} audit event payload for publishAuditEvent
 */
export const buildCredentialFailureEvent = ({ correlationId, reason }) => ({
  correlationid: correlationId,
  security: {
    pmccode: CREDENTIAL_FAILURE_PMCCODE,
    details: {
      message: reason
    }
  },
  audit: {
    entities: [{ entity: 'service', action: 'authenticate', entityid: '' }],
    accounts: {},
    status: auditStatuses.FAILURE,
    details: { reason }
  }
})
