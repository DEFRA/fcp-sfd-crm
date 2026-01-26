import { vi, describe, beforeEach, test, expect } from 'vitest'
import { PublishCommand } from '@aws-sdk/client-sns'
import { publish } from '../../../src/sns/publish.js'

const mockSnsClient = {
  send: vi.fn()
}

vi.mock('@aws-sdk/client-sns')

describe('SNS ')
