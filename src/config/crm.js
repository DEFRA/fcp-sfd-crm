export const crmConfig = {
  crm: {
    baseUrl: {
      doc: 'Base Url for the CRM instance.',
      format: String,
      default: null,
      env: 'CRM_API_BASE_URL'
    },
    caseOriginCode: {
      doc: 'Case origin code applied to CRM cases (incidents).',
      format: Number,
      default: 3,
      env: 'CRM_CASE_ORIGIN_CODE'
    },
    writeFilesInSubmission: {
      doc: 'Enable writing rpa_filesinsubmission to the online submission activity only after the Dataverse attribute has been confirmed in the target environment.',
      format: Boolean,
      default: false,
      env: 'CRM_WRITE_FILES_IN_SUBMISSION'
    },
    integrationInboundFailureProcessingEntity: {
      doc: 'When set, enable CRM triage writes for terminal inbound failures and bind this value to rpa_processingentity.',
      format: (value) => {
        if (value === null || value === undefined) {
          return
        }

        const trimmed = String(value).trim()
        if (trimmed === '') {
          return
        }

        const parsed = Number(trimmed)
        if (!Number.isSafeInteger(parsed)) {
          throw new Error('must be an integer option-set value or empty')
        }
      },
      default: '',
      env: 'CRM_INTEGRATION_INBOUND_FAILURE_PROCESSING_ENTITY'
    }
  }
}
