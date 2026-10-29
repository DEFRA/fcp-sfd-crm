import { afterEach, describe, expect, test } from 'vitest'
import convict from 'convict'
import convictFormatWithValidator from 'convict-format-with-validator'
import { messagingConfig } from '../../../src/config/messaging.js'

// src/config/index.js registers these before building the config; the 'url'
// format on the dead letter queue URLs is unknown to convict without them.
convict.addFormats(convictFormatWithValidator)

describe('src/config/messaging.js', () => {
  const originalRequestDlqUrl = process.env.CRM_REQUEST_DLQ_URL
  const originalEventsDlqUrl = process.env.CRM_EVENTS_DLQ_URL

  afterEach(() => {
    if (originalRequestDlqUrl === undefined) {
      delete process.env.CRM_REQUEST_DLQ_URL
    } else {
      process.env.CRM_REQUEST_DLQ_URL = originalRequestDlqUrl
    }

    if (originalEventsDlqUrl === undefined) {
      delete process.env.CRM_EVENTS_DLQ_URL
    } else {
      process.env.CRM_EVENTS_DLQ_URL = originalEventsDlqUrl
    }
  })

  test('maps inbound and outbound dead letter queue URLs independently', () => {
    process.env.CRM_REQUEST_DLQ_URL = 'https://request-dlq.test'
    process.env.CRM_EVENTS_DLQ_URL = 'https://events-dlq.test'

    const config = convict(messagingConfig)

    expect(config.get('messaging.crmRequest.deadLetterUrl')).toBe('https://request-dlq.test')
    expect(config.get('messaging.crmEvents.publishDlqUrl')).toBe('https://events-dlq.test')
  })

  test('passes startup validation when both dead letter queue URLs are set', () => {
    process.env.CRM_REQUEST_DLQ_URL = 'https://request-dlq.test'
    process.env.CRM_EVENTS_DLQ_URL = 'https://events-dlq.test'

    const config = convict(messagingConfig)

    expect(() => config.validate({ allowed: 'strict' })).not.toThrow()
  })

  test('fails startup validation when CRM_REQUEST_DLQ_URL is missing', () => {
    delete process.env.CRM_REQUEST_DLQ_URL
    process.env.CRM_EVENTS_DLQ_URL = 'https://events-dlq.test'

    const config = convict(messagingConfig)

    expect(() => config.validate({ allowed: 'strict' })).toThrow(/messaging\.crmRequest\.deadLetterUrl: /)
  })

  test('fails startup validation when CRM_EVENTS_DLQ_URL is missing', () => {
    process.env.CRM_REQUEST_DLQ_URL = 'https://request-dlq.test'
    delete process.env.CRM_EVENTS_DLQ_URL

    const config = convict(messagingConfig)

    expect(() => config.validate({ allowed: 'strict' })).toThrow(/messaging\.crmEvents\.publishDlqUrl: /)
  })

  test('fails startup validation when CRM_REQUEST_DLQ_URL is empty', () => {
    process.env.CRM_REQUEST_DLQ_URL = ''
    process.env.CRM_EVENTS_DLQ_URL = 'https://events-dlq.test'

    const config = convict(messagingConfig)

    expect(() => config.validate({ allowed: 'strict' })).toThrow(/messaging\.crmRequest\.deadLetterUrl: must be a URL/)
  })

  test('fails startup validation when CRM_EVENTS_DLQ_URL is empty', () => {
    process.env.CRM_REQUEST_DLQ_URL = 'https://request-dlq.test'
    process.env.CRM_EVENTS_DLQ_URL = ''

    const config = convict(messagingConfig)

    expect(() => config.validate({ allowed: 'strict' })).toThrow(/messaging\.crmEvents\.publishDlqUrl: must be a URL/)
  })
})
