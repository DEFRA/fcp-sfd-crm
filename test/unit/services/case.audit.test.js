import { vi, describe, beforeEach, test, expect } from 'vitest'

vi.mock('../../../src/services/create-case-with-online-submission-in-crm.js', () => ({ createCaseWithOnlineSubmissionInCrm: vi.fn() }))
vi.mock('../../../src/repos/cases.js', () => ({ upsertCase: vi.fn(), updateCaseId: vi.fn(), markFileProcessed: vi.fn() }))
vi.mock('../../../src/auth/get-crm-auth-token.js', () => ({ getCrmAuthToken: vi.fn().mockResolvedValue('token') }))
vi.mock('../../../src/messaging/outbound/received-event/publish-received-event.js', () => ({ publishReceivedEvent: vi.fn().mockResolvedValue(true) }))
vi.mock('../../../src/messaging/outbound/audit/send-audit-event.js', () => ({ sendAuditEvent: vi.fn().mockResolvedValue(true) }))
vi.mock('../../../src/logging/logger.js', () => ({ createLogger: vi.fn().mockReturnValue({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))

const { createCase } = await import('../../../src/services/case.js')
const { createCaseWithOnlineSubmissionInCrm } = await import('../../../src/services/create-case-with-online-submission-in-crm.js')
const { publishReceivedEvent } = await import('../../../src/messaging/outbound/received-event/publish-received-event.js')
const { sendAuditEvent } = await import('../../../src/messaging/outbound/audit/send-audit-event.js')
const { upsertCase, updateCaseId, markFileProcessed } = await import('../../../src/repos/cases.js')

describe('case service audit emissions', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        upsertCase.mockResolvedValue({ isNew: true, isDuplicateFile: false, caseId: null, isCreator: true })
    })

    test('createCase emits document.created and audit after creating a new case', async () => {
        createCaseWithOnlineSubmissionInCrm.mockResolvedValue({ caseId: 'case-1', contactId: 'c', accountId: 'a', rpaOnlinesubmissionid: 'rpa-1' })

        const payload = {
            data: {
                correlationId: 'corr-10',
                file: { fileId: 'file-1', fileName: 'f.txt', contentType: 'text/plain' },
                crn: '1234',
                sbi: '5678'
            }
        }

        const res = await createCase(payload)
        // wait for background publish/audit setImmediate tasks
        await new Promise(r => setImmediate(r))

        expect(res.caseId).toBe('case-1')
        expect(updateCaseId).toHaveBeenCalled()
        expect(markFileProcessed).toHaveBeenCalled()
        expect(publishReceivedEvent).toHaveBeenCalled()
        expect(sendAuditEvent).toHaveBeenCalled()
    })

    test('addMetadataToExistingCase emits document.created and audit after metadata creation', async () => {
        upsertCase.mockResolvedValue({ isNew: false, isDuplicateFile: false, caseId: 'existing-case', isCreator: false })
        // ensure createMetadataForOnlineSubmission is called via createCase flow; instead simulate addMetadata path by calling createCase with prep indicating addMetadata

        // To reach addMetadata path, set isNew false and provide caseId in upsertCase
        createCaseWithOnlineSubmissionInCrm.mockResolvedValue({ caseId: 'case-should-not-be-used' })

        const payload = {
            data: {
                correlationId: 'corr-11',
                file: { fileId: 'file-2', fileName: 'g.txt', contentType: 'text/plain' },
                crn: '1234',
                sbi: '5678'
            }
        }

        // Mock createMetadataForOnlineSubmission and getOnlineSubmissionId via dynamic import of repos/crm.js
        const reposCrm = await import('../../../src/repos/crm.js')
        vi.spyOn(reposCrm, 'createMetadataForOnlineSubmission').mockResolvedValue({ metadataId: 'meta-1', error: null })
        vi.spyOn(reposCrm, 'getOnlineSubmissionId').mockResolvedValue({ rpaOnlinesubmissionid: 'rpa-1', error: null })

        const res = await createCase(payload)
        await new Promise(r => setImmediate(r))

        expect(res.skipped).toBeUndefined()
        expect(markFileProcessed).toHaveBeenCalled()
        expect(publishReceivedEvent).toHaveBeenCalled()
        expect(sendAuditEvent).toHaveBeenCalled()
    })
})
