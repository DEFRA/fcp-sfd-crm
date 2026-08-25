// Metric names for the creator-role transitions. Every name except
// WAITING_FOR_CASE is also used as the log event.type for the same
// transition, so that a name found in a metric and a name found in a log
// line always refer to the same event.
export const caseCreationMetrics = Object.freeze({
  WAITING_FOR_CASE: 'crm.case.waiting_for_case',
  CREATOR_ROLE_CLAIMED: 'crm.case.creator_role_claimed',
  CREATOR_ROLE_RELEASED: 'crm.case.creator_role_released',
  CREATOR_RELEASE_FAILED: 'crm.case.creator_release_failed'
})

export const caseActions = Object.freeze({
  SKIP: 'skip',
  CREATE: 'create',
  ADD_METADATA: 'addMetadata'
})
