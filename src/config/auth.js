export const authConfig = {
  auth: {
    tokenEndpoint: {
      doc: 'Endpoint to retrieve Bearer token from Microsoft.',
      format: String,
      default: null,
      env: 'CRM_AUTH_ENDPOINT'
    },
    clientId: {
      doc: 'Client ID for authenticating with CRM.',
      format: String,
      default: null,
      env: 'CRM_AUTH_CLIENT_ID'
    },
    tenantId: {
      doc: 'Azure AD tenant ID for CRM authentication.',
      format: String,
      default: null,
      nullable: true,
      env: 'CRM_AUTH_TENANT_ID'
    },
    clientSecret: {
      doc: 'Client secret for authentication with CRM (retained for rollback; unused when federated credentials are active).',
      format: String,
      default: null,
      nullable: true,
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
      default: 'crmAuthToken'
    },
    federatedCredentials: {
      audience: {
        doc: 'Audience value presented to AWS STS when requesting the web identity token.',
        format: String,
        default: null,
        nullable: true,
        env: 'CRM_AUTH_FEDERATED_AUDIENCE'
      },
      enableMocking: {
        doc: 'Use MockProvider instead of WebIdentityTokenProvider (local development only).',
        format: Boolean,
        default: false,
        env: 'CRM_AUTH_FEDERATED_MOCK'
      }
    }
  }
}
