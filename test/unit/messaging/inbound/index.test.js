import { vi, describe, test, expect, beforeEach } from 'vitest'

import { sqsClient } from '../../../../src/messaging/sqs/client.js'
import { startCommsListener, stopCommsListener } from '../../../../src/messaging/inbound/consumer.js'

vi.mock('../../../../src/messaging/inbound/consumer.js')

const { startMessaging, stopMessaging } = await import('../../../../src/messaging/inbound/index.js')

describe('inbound messaging setup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('should start message consumers', () => {
    startMessaging()

    expect(startCommsListener).toHaveBeenCalledWith(sqsClient)
  })

  test('should stop message consumers', () => {
    stopMessaging()

    expect(stopCommsListener).toHaveBeenCalled()
  })
})
