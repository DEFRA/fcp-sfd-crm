import { afterEach, describe, expect, test } from 'vitest'
import convict from 'convict'
import { messagingConfig } from '../../../src/config/messaging.js'

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
})
