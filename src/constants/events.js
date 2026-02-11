import { caseTypes } from './case-types.js'

export const crmEvents = {
  CASE_CREATED: 'uk.gov.fcp.sfd.crm.case.created',
  DOCUMENT_UPLOAD: 'uk.gov.fcp.sfd.document.uploaded'
}

export const eventToTypeMap = {
  [crmEvents.CASE_CREATED]: caseTypes.CASE_CREATED,
  [crmEvents.DOCUMENT_UPLOAD]: caseTypes.DOCUMENT_UPLOAD
}
