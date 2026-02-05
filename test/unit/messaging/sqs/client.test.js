import { describe, test, expect } from 'vitest'

import { sqsClient } from '../../../../src/messaging/sqs/client.js'

describe('sqs client', () => {
  test('should create an SQS client instance', () => {
    expect(sqsClient).toBeDefined()
  })
})
