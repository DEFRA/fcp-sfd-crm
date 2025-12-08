export const authConfig = {
  auth: {
    tokenEndpoint: {
      doc: 'Endpoint to retrieve Bearer token from Microsoft.',
      format: String,
      default: null,
      env: 'CRM_AUTH_ENDPOINT'
    },
    tenantId: {
      doc: 'Unique ID of the Azure Active Directory the application uses to sign in and get tokens.',
      format: String,
      default: null,
      env: 'CRM_AUTH_TENANT_ID'
    },
    clientId: {
      doc: 'Client ID for authenticating with CRM.',
      format: String,
      default: null,
      env: 'CRM_AUTH_CLIENT_ID'
    },
    clientSecret: {
      doc: 'Client secret for authentication with CRM.',
      format: String,
      default: null,
      env: 'CRM_AUTH_CLIENT_SECRET',
      sensitive: true
    },
    scope: {
      doc: 'Scope for the CRM Auth credentials.',
      format: String,
      default: null,
      env: 'CRM_AUTH_SCOPE'
    },
    tokenId: {
      doc: 'Identifier for the stored token in the database.',
      format: String,
      default: 'crmAuthToken',
    }
  }
}
