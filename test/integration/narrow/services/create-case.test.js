import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../../../src/auth/get-crm-auth-token.js', () => ({
  getCrmAuthToken: vi.fn(async () => 'mock-token')
}))

vi.mock('../../../../src/services/create-case-with-online-submission-in-crm.js', () => ({
  createCaseWithOnlineSubmissionInCrm: vi.fn(async () => ({ caseId: 'int-case-1', contactId: 'c1', accountId: 'a1' }))
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
        crn: 'crn-int',
        sbi: 'sbi-int',
        crm: { title: 'Integration Test' },
        file: { fileId: 'file-int-1', fileName: 'file.pdf', url: 'http://file', contentType: 'application/pdf' },
        correlationId: 'corr-int-1'
      }
    }

    const response = await createCase(payload)

    expect(response.caseId).toBe('int-case-1')

    const doc = await db.collection(COLLECTION).findOne({ correlationId: 'corr-int-1' })
    expect(doc).toBeDefined()
    expect(doc.caseId).toBe('int-case-1')
    expect(doc.processedFileIds).toContain('file-int-1')
    expect(doc.creatorFileId).toBe('file-int-1')
  })

  test('subsequent identical message is skipped and returns existing caseId', async () => {
    const payload = {
      data: {
        crn: 'crn-int',
        sbi: 'sbi-int',
        crm: { title: 'Integration Test' },
        file: { fileId: 'file-int-2', fileName: 'file.pdf', url: 'http://file', contentType: 'application/pdf' },
        correlationId: 'corr-int-2'
      }
    }

    // first call
    const first = await createCase(payload)
    expect(first.caseId).toBe('int-case-1')

    // second call with same correlationId + fileId should return skipped with caseId
    const second = await createCase(payload)
    expect(second.skipped).toBe(true)
    expect(second.caseId).toBe('int-case-1')
  })
})
