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
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    })
  })

  test('should create SNS client without access/secret key in production', async () => {
    process.env.NODE_ENV = 'production'
    vi.resetModules()
    const { snsClient } = await import('../../../../src/messaging/sns/client.js')
    expect(snsClient).toBeDefined()
    // In production, credentials may still be present in .env.test, so check for both possible calls
    const expectedProdCall = {
      endpoint: process.env.AWS_SNS_ENDPOINT,
      region: process.env.AWS_REGION
    }
    // The SNSClient may be called with credentials or not, depending on config logic
    const calls = SNSClient.mock.calls.map(call => call[0])
    expect(calls).toContainEqual(expectedProdCall)
  })

  afterEach(() => {
    process.env = originalEnv
  })
})
