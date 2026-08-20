import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../../../src/auth/get-crm-auth-token.js', () => ({
  getCrmAuthToken: vi.fn(async () => 'mock-token')
}))

vi.mock('../../../../src/services/create-case-with-online-submission-in-crm.js', () => ({
  createCaseWithOnlineSubmissionInCrm: vi.fn(async () => ({ caseId: 'int-case-1', contactId: 'c1', accountId: 'a1' })),
  resolveDocumentTypeOrThrow: vi.fn(async () => ({ documentTypesId: 'doc-type-int-1' }))
}))

vi.mock('../../../../src/repos/crm.js', () => ({
  getOnlineSubmissionActivityId: vi.fn(async () => ({ onlineSubmissionActivityId: 'ols-int-1', error: null })),
  createMetadataForOnlineSubmission: vi.fn(async () => ({ metadataId: 'meta-int-1', error: null }))
}))

import db from '../../../../src/data/db.js'
import { createCase } from '../../../../src/services/case.js'
import { createCaseWithOnlineSubmissionInCrm } from '../../../../src/services/create-case-with-online-submission-in-crm.js'

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

describe('Integration - creator role recovery across out-of-order file arrival', () => {
  const correlationId = 'corr-int-recovery'
  const filePayload = (fileId) => ({
    data: {
      crn: 'crn-int',
      sbi: 'sbi-int',
      crm: { title: 'Integration Test' },
      file: { fileId, fileName: 'file.pdf', url: 'http://file', contentType: 'application/pdf' },
      correlationId
    }
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    await db.collection(COLLECTION).deleteMany({})
  })

  afterEach(async () => {
    await db.collection(COLLECTION).deleteMany({})
  })

  test('a submission recovers and produces exactly one case when the first file to be processed is not the one that creates it', async () => {
    const nonRetryableErr = new Error('Unable to create case with online submission activity in CRM')
    nonRetryableErr.retryable = false
    createCaseWithOnlineSubmissionInCrm.mockRejectedValueOnce(nonRetryableErr)

    // File A is first-seen and becomes the creator, but fails non-retryably.
    await createCase(filePayload('file-recovery-a')).catch((e) => e)

    let doc = await db.collection(COLLECTION).findOne({ correlationId })
    expect(doc.caseId).toBeNull()
    expect(doc.creatorFileId).toBeNull()

    createCaseWithOnlineSubmissionInCrm.mockResolvedValueOnce({ caseId: 'int-case-recovery', contactId: 'c1', accountId: 'a1' })

    // File B, arriving after the failure, claims the released role and creates the case.
    const responseB = await createCase(filePayload('file-recovery-b'))
    expect(responseB.caseId).toBe('int-case-recovery')

    doc = await db.collection(COLLECTION).findOne({ correlationId })
    expect(doc.caseId).toBe('int-case-recovery')
    expect(doc.creatorFileId).toBe('file-recovery-b')

    // File C, arriving last, finds the case already created and attaches its metadata to it.
    const responseC = await createCase(filePayload('file-recovery-c'))
    expect(responseC.caseId).toBe('int-case-recovery')

    doc = await db.collection(COLLECTION).findOne({ correlationId })
    expect(doc.processedFileIds).toEqual(expect.arrayContaining(['file-recovery-b', 'file-recovery-c']))
    expect(doc.processedFileIds).not.toContain('file-recovery-a')

    // Exactly one case identifier was ever produced for this correlationId.
    expect(createCaseWithOnlineSubmissionInCrm).toHaveBeenCalledTimes(2)
  })
})
