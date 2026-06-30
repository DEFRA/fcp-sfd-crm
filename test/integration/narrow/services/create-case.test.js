import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../../../src/auth/get-crm-auth-token.js', () => ({
  getCrmAuthToken: vi.fn(async () => 'mock-token')
}))


vi.mock('../../../../src/services/create-case-with-online-submission-in-crm.js', () => ({
  createCaseWithOnlineSubmissionInCrm: vi.fn(async () => ({ caseId: '11111111-1111-4111-8111-111111111111', contactId: 'c1', accountId: 'a1' }))
}))

import db from '../../../../src/data/db.js'
import { createCase } from '../../../../src/services/case.js'

const COLLECTION = 'cases'

describe('Integration - createCase first request processing', () => {
  beforeEach(async () => {
    await db.collection(COLLECTION).deleteMany({})
  })

  afterEach(async () => {
    await db.collection(COLLECTION).deleteMany({})
  })

  test('first request creates CRM case, stores result and returns it', async () => {
    const payload = {
      data: {
        crn: 1050000000,
        sbi: 105000000,
        crm: { title: 'Integration Test' },
        file: { fileId: '11111111-2222-4222-8222-222222222222', fileName: 'file.pdf', url: 'http://file', contentType: 'application/pdf' },
        correlationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      }
    }

    const response = await createCase(payload)

    expect(response.caseId).toBe('11111111-1111-4111-8111-111111111111')

    const doc = await db.collection(COLLECTION).findOne({ correlationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })
    expect(doc).toBeDefined()
    expect(doc.caseId).toBe('11111111-1111-4111-8111-111111111111')
    expect(doc.processedFileIds).toContain('11111111-2222-4222-8222-222222222222')
    expect(doc.creatorFileId).toBe('11111111-2222-4222-8222-222222222222')
  })

  test('subsequent identical message is skipped and returns existing caseId', async () => {
    const payload = {
      data: {
        crn: 1050000000,
        sbi: 105000000,
        crm: { title: 'Integration Test' },
        file: { fileId: '33333333-3333-4333-8333-333333333333', fileName: 'file.pdf', url: 'http://file', contentType: 'application/pdf' },
        correlationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      }
    }

    // first call
    const first = await createCase(payload)
    expect(first.caseId).toBe('11111111-1111-4111-8111-111111111111')

    // second call with same correlationId + fileId should return skipped with caseId
    const second = await createCase(payload)
    expect(second.skipped).toBe(true)
    expect(second.caseId).toBe('11111111-1111-4111-8111-111111111111')
  })
})
