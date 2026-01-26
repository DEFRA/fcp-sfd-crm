import { vi, describe, afterEach, beforeAll, beforeEach, test, expect } from 'vitest'

const SNSClient = vi.fn()

vi.mock('@aws-sdk/client-sns', () => {
  return {
    SNSClient
  }
})

const snsEndpoint = process.env.SNS_ENDPOINT

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

    const { snsClient } = await import('../../../../src/messaging/sns/client.js')

    expect(snsClient).toBeDefined()

    expect(SNSClient).toHaveBeenCalledWith({
      endpoint: snsEndpoint,
      region: 'eu-west-2',
      credentials: {
        accessKeyId: 'test',
        secretAccessKey: 'test'
      }
    })
  })

  test('should create SNS client without access/secret key in production', async () => {
    process.env.NODE_ENV = 'production'

    const { snsClient } = await import('../../../../src/messaging/sns/client.js')

    expect(snsClient).toBeDefined()

    expect(SNSClient).toHaveBeenCalledWith({
      endpoint: snsEndpoint,
      region: 'eu-west-2'
    })
  })

  afterEach(() => {
    process.env = originalEnv
  })
})
