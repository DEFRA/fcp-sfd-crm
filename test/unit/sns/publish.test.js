import { vi, describe, beforeEach, test, expect } from 'vitest'
import { PublishCommand } from '@aws-sdk/client-sns'
import { publish } from '../../../src/sns/publish.js'

const mockSnsClient = {
  send: vi.fn()
}

vi.mock('@aws-sdk/client-sns')

describe('SNS Publish', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
  })

  test('should receive and execute publish command', async () => {
    const topicArn = 'arn:aws:sns:eu-west-2:000000000000:fcp_fdm_events'

    const message = {
      test: 'hello world',
      id: '149C5ACA-C971-45BA-8D94-9664A91B5471'
    }

    await publish(mockSnsClient, topicArn, message)

    expect(PublishCommand).toHaveBeenCalledWith({
      TopicArn: 'arn:aws:sns:eu-west-2:000000000000:fcp_fdm_events',
      Message: JSON.stringify(message)
    })

    expect(mockSnsClient.send).toHaveBeenCalledTimes(1)
  })
})
