import { describe, test, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../../src/config/index.js', () => ({
  config: {
    get: vi.fn()
  }
}))

const { config } = await import('../../../../src/config/index.js')

describe('sqs client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    config.get.mockImplementation((key) => {
      if (key === 'aws.sqsEndpoint') return 'https://sqs.eu-west-2.amazonaws.com'
      if (key === 'aws.region') return 'eu-west-2'
      if (key === 'env') return 'development'
      return undefined
    })
  })

  test('should create an SQS client instance', async () => {
    const { sqsClient } = await import('../../../../src/messaging/sqs/client.js')
    expect(sqsClient).toBeDefined()
  })

  test('should use the configured endpoint', async () => {
    config.get.mockImplementation((key) => {
      if (key === 'aws.sqsEndpoint') return 'http://floci:4566'
      if (key === 'aws.region') return 'eu-west-2'
      if (key === 'env') return 'development'
      return undefined
    })
    vi.resetModules()
    const mod = await import('../../../../src/messaging/sqs/client.js')
    expect(mod.sqsClient).toBeDefined()
    expect(await mod.sqsClient.config.endpoint()).toStrictEqual({
      hostname: 'floci',
      path: '/',
      port: 4566,
      protocol: 'http:',
      query: undefined
    })
  })
})
