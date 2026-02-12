import { vi, describe, test, expect, beforeEach } from 'vitest'

import { sqsClient } from '../../../../src/messaging/sqs/client.js'
import { startCRMListener, stopCRMListener } from '../../../../src/messaging/inbound/consumer.js'

vi.mock('../../../../src/data/db.js', () => ({
  default: {
    collection: () => ({
      createIndex: vi.fn().mockResolvedValue(),
      findOne: vi.fn().mockResolvedValue(null),
      insertOne: vi.fn().mockResolvedValue({ acknowledged: true })
    })
  }
}))

vi.mock('../../../../src/messaging/inbound/consumer.js', () => ({
  startCRMListener: vi.fn(),
  stopCRMListener: vi.fn()
}))

const { startMessaging, stopMessaging } = await import('../../../../src/messaging/inbound/index.js')

describe('inbound messaging setup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('should start message consumers', () => {
    startMessaging()

    expect(startCRMListener).toHaveBeenCalledWith(sqsClient)
  })

  test('should stop message consumers', () => {
    stopMessaging()

    expect(stopCRMListener).toHaveBeenCalled()
  })
})
