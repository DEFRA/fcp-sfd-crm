import { vi, describe, beforeEach, test, expect } from 'vitest'

// Mock dependencies
vi.mock('../../../src/services/create-case-with-online-submission-in-crm.js', () => ({ createCaseWithOnlineSubmissionInCrm: vi.fn() }))
vi.mock('../../../src/repos/cases.js', () => ({ upsertCase: vi.fn(), updateCaseId: vi.fn(), markFileProcessed: vi.fn() }))
vi.mock('../../../src/auth/get-crm-auth-token.js', () => ({ getCrmAuthToken: vi.fn().mockResolvedValue('token') }))
vi.mock('../../../src/messaging/outbound/received-event/publish-received-event.js', () => ({ publishReceivedEvent: vi.fn().mockResolvedValue(true) }))
// We'll control sendAuditEvent per-test
vi.mock('../../../src/messaging/outbound/audit/send-audit-event.js', () => ({ sendAuditEvent: vi.fn() }))

const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('../../../src/logging/logger.js', () => ({ createLogger: () => mockLogger }))

const { createCase } = await import('../../../src/services/case.js')
const { createCaseWithOnlineSubmissionInCrm } = await import('../../../src/services/create-case-with-online-submission-in-crm.js')
const { upsertCase, updateCaseId, markFileProcessed } = await import('../../../src/repos/cases.js')
const { sendAuditEvent } = await import('../../../src/messaging/outbound/audit/send-audit-event.js')

describe('case service audit publish failures', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        upsertCase.mockResolvedValue({ isNew: true, isDuplicateFile: false, caseId: null, isCreator: true })
        updateCaseId.mockResolvedValue({ modifiedCount: 1 })
        markFileProcessed.mockResolvedValue({ modifiedCount: 1 })
        createCaseWithOnlineSubmissionInCrm.mockResolvedValue({ caseId: 'case-100' })
    })

    test('logs audit_publish_failed when sendAuditEvent rejects after case creation (schema)', async () => {
        // make sendAuditEvent reject with a schema-like error
        sendAuditEvent.mockRejectedValueOnce(new Error('Schema validation failed'))

        const payload = {
            data: {
                correlationId: 'corr-schema',
                file: { fileId: 'file-a', fileName: 'a.txt' },
                crn: 'crn-x'
            }
        }

        const res = await createCase(payload)
        // allow background setImmediate tasks to run
        await new Promise(r => setImmediate(r))

        expect(res.caseId).toBe('case-100')
        expect(mockLogger.error).toHaveBeenCalled()
        // assert that our logger was called with the audit_publish_failed tag
        const call = mockLogger.error.mock.calls.find(c => String(c[1]).includes('audit_publish_failed'))
        expect(call).toBeTruthy()
    })

    test('logs audit_publish_failed when sendAuditEvent rejects after metadata creation (transport)', async () => {
        // Reach addMetadata path
        upsertCase.mockResolvedValue({ isNew: false, isDuplicateFile: false, caseId: 'existing-case', isCreator: false })
        // mock repos/crm helpers to provide online submission id and metadata creation
        const reposCrm = await import('../../../src/repos/crm.js')
        vi.spyOn(reposCrm, 'getOnlineSubmissionId').mockResolvedValue({ rpaOnlinesubmissionid: 'rpa-1', error: null })
        vi.spyOn(reposCrm, 'createMetadataForOnlineSubmission').mockResolvedValue({ metadataId: 'meta-900', error: null })

        // simulate transport error from audit publisher
        sendAuditEvent.mockRejectedValueOnce(new Error('publish-transport-failure'))

        const payload = {
            data: {
                correlationId: 'corr-transport',
                file: { fileId: 'file-b', fileName: 'b.txt' },
                crn: 'crn-y'
            }
        }

        const res = await createCase(payload)
        await new Promise(r => setImmediate(r))

        expect(res.caseId).toBe('existing-case')
        expect(mockLogger.error).toHaveBeenCalled()
        const call = mockLogger.error.mock.calls.find(c => String(c[1]).includes('audit_publish_failed'))
        expect(call).toBeTruthy()
    })
})
