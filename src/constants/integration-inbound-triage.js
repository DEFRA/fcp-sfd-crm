export const triageFailureReasons = {
  CONTACT_NOT_FOUND_FOR_CRN: 'contact_not_found_for_crn',
  ACCOUNT_NOT_FOUND_FOR_SBI: 'account_not_found_for_sbi',
  DOCUMENT_TYPE_NOT_FOUND: 'document_type_not_found',
  DOCUMENT_TYPE_METADATA_INCOMPLETE: 'document_type_metadata_incomplete'
}

export const triageSkipReasons = {
  CONFIG_MISSING_OR_EMPTY: 'config_missing_or_empty',
  DUPLICATE_SUPPRESSED: 'duplicate_suppressed'
}

export const triageEventTypes = {
  WRITE_SKIPPED: 'crm.integration_inbound.triage_write_skipped',
  WRITE_SUCCEEDED: 'crm.integration_inbound.triage_write_succeeded',
  WRITE_FAILED: 'crm.integration_inbound.triage_write_failed'
}
