/**
 * CRM identity lookup event constants
 * Mirrors the pattern in messaging-events.js and integration-inbound-triage.js
 */

export const crmLookupEventTypes = {
  FAILED: 'crm.lookup.failed',
  IDENTIFIER_NOT_FOUND: 'crm.lookup.identifier_not_found'
}

export const crmLookupActions = {
  LOOKUP_CONTACT: 'lookup_contact',
  LOOKUP_ACCOUNT: 'lookup_account'
}

export const crmLookupCategories = {
  CRM: 'crm'
}

export const crmLookupOutcomes = {
  FAILURE: 'failure'
}
