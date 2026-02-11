import { caseTypes } from './case-types.js'

const crmEvents = {
  CASE_CREATED: 'uk.gov.fcp.sfd.crm.case.created'
}

const typeToEventMap = {
  [caseTypes.CASE_CREATED]: CASE_CREATED
}
