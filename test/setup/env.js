// Provide minimal environment variables required by convict schemas for tests
process.env.CRM_AUTH_ENDPOINT = process.env.CRM_AUTH_ENDPOINT || 'https://auth.test'
process.env.CRM_AUTH_CLIENT_ID = process.env.CRM_AUTH_CLIENT_ID || 'test-client-id'
process.env.CRM_AUTH_CLIENT_SECRET = process.env.CRM_AUTH_CLIENT_SECRET || 'test-client-secret'
process.env.CRM_AUTH_SCOPE = process.env.CRM_AUTH_SCOPE || 'test-scope'
process.env.CRM_API_BASE_URL = process.env.CRM_API_BASE_URL || 'https://crm.test'
process.env.CRM_QUEUE_URL = process.env.CRM_QUEUE_URL || 'https://queue-url'
process.env.CRM_DEAD_LETTER_QUEUE_URL = process.env.CRM_DEAD_LETTER_QUEUE_URL || 'https://dead-letter'
process.env.CRM_EVENTS_TOPIC_ARN = process.env.CRM_EVENTS_TOPIC_ARN || 'arn:aws:sns:eu-west-2:123:topic'
process.env.AWS_SNS_ENDPOINT = process.env.AWS_SNS_ENDPOINT || 'https://sns.eu-west-2.amazonaws.com'
process.env.AWS_REGION = process.env.AWS_REGION || 'eu-west-2'
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'test-access-key'
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'test-secret-key'

// Default NODE_ENV to 'test' if not already set
process.env.NODE_ENV = process.env.NODE_ENV || 'test'
