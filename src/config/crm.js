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
    }
  }
}
