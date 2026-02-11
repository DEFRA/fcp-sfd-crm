import { caseTypes } from './case-types.js'

const crmEvents = {
  CASE_CREATED: 'uk.gov.fcp.sfd.crm.case.created',
  DOCUMENT_UPLOAD: 'uk.gov.fcp.sfd.document.uploaded'
}

export const typeToEventMap = {
  [caseTypes.CASE_CREATED]: crmEvents.CASE_CREATED,
  [caseTypes.DOCUMENT_UPLOAD]: crmEvents.DOCUMENT_UPLOAD
}
