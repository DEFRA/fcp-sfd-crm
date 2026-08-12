import { vi, describe, afterEach, beforeAll, beforeEach, test, expect } from 'vitest'

const SNSClient = vi.fn()

vi.mock('@aws-sdk/client-sns', () => {
  return {
    SNSClient
  }
})

describe('SNS Client', () => {
  let originalEnv

  beforeAll(() => {
    originalEnv = process.env
  })

  beforeEach(async () => {
    vi.resetModules()
  })

  test('should create SNS client with access/secret key in development', async () => {
    process.env.NODE_ENV = 'development'
    vi.resetModules()
    const { snsClient } = await import('../../../../src/messaging/sns/client.js')
    expect(snsClient).toBeDefined()
    expect(SNSClient).toHaveBeenCalledWith({
      endpoint: process.env.AWS_SNS_ENDPOINT,
      region: process.env.AWS_REGION,
      requestHandler: {
        requestTimeout: 3000,
        connectionTimeout: 3000
      },
      maxAttempts: 2,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    })
  })

  // A publish inside the SQS handleMessage callback must be bounded, or a
  // degraded SNS endpoint can push message processing past the queue's
  // visibility timeout and cause redelivery.
  test('should bound every SNS request with an explicit timeout and attempt limit', async () => {
    process.env.NODE_ENV = 'development'
    vi.resetModules()
    await import('../../../../src/messaging/sns/client.js')

    const [snsConfig] = SNSClient.mock.calls.at(-1)
    expect(snsConfig.requestHandler.requestTimeout).toBeGreaterThan(0)
    expect(snsConfig.requestHandler.connectionTimeout).toBeGreaterThan(0)
    expect(snsConfig.maxAttempts).toBeGreaterThan(0)
  })

  test('should create SNS client without access/secret key in production', async () => {
    process.env.NODE_ENV = 'production'
    vi.resetModules()
    const { snsClient } = await import('../../../../src/messaging/sns/client.js')
    expect(snsClient).toBeDefined()
    const expectedProdCall = {
      endpoint: process.env.AWS_SNS_ENDPOINT,
      region: process.env.AWS_REGION,
      requestHandler: {
        requestTimeout: 3000,
        connectionTimeout: 3000
      },
      maxAttempts: 2
    }
    // The SNSClient may be called with credentials or not, depending on config logic
    const calls = SNSClient.mock.calls.map(call => call[0])
    expect(calls).toContainEqual(expectedProdCall)
  })

  afterEach(() => {
    process.env = originalEnv
  })
})
