export const caseCreationMetrics = {
  WAITING_FOR_CASE: 'crm.case.waiting_for_case',
  CREATOR_ROLE_CLAIMED: 'crm.case.creator_role_claimed',
  CREATOR_ROLE_RELEASED: 'crm.case.creator_role_released'
}

// Log event.type values for the same creator-role transitions, kept in the
// same module as, and using the same names as, the metrics above so the two
// families cannot drift apart.
export const caseCreationEvents = {
  CREATOR_ROLE_CLAIMED: caseCreationMetrics.CREATOR_ROLE_CLAIMED,
  CREATOR_ROLE_RELEASED: caseCreationMetrics.CREATOR_ROLE_RELEASED
}

export const caseActions = Object.freeze({
  SKIP: 'skip',
  CREATE: 'create',
  ADD_METADATA: 'addMetadata'
})
