import { describe, vi, test, beforeEach, expect } from 'vitest'

const mockLogger = {
  error: vi.fn()
}

vi.mock('../../../src/logging/logger.js', () => ({
  createLogger: () => mockLogger
}))

vi.mock('../../../src/repos/crm.js', () => ({
  getContactIdFromCrn: vi.fn(),
  getAccountIdFromSbi: vi.fn(),
  createCaseWithOnlineSubmission: vi.fn()
}))

const { createCaseWithOnlineSubmissionInCrm } = await import('../../../src/services/create-case-with-online-submission-in-crm.js')
const { getContactIdFromCrn, getAccountIdFromSbi, createCaseWithOnlineSubmission } = await import('../../../src/repos/crm.js')

describe('createCaseWithOnlineSubmission service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test()
})
