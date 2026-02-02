import { describe, it, expect, vi } from 'vitest'
import * as caseService from '../../../src/services/caseService.js'
import { transformPayload } from '../../../src/services/caseService.js'

// Mocks
vi.mock('../../../src/logging/logger.js', () => ({ createLogger: () => ({ info: vi.fn(), error: vi.fn() }) }))
vi.mock('../../../src/auth/get-crm-auth-token.js', () => ({ getCrmAuthToken: vi.fn(async () => 'mock-token') }))
vi.mock('../../../src/services/create-case-with-online-submission-in-crm.js', () => ({
    createCaseWithOnlineSubmissionInCrm: vi.fn(async () => ({ caseId: 'mock-case-id', status: 'success' }))
}))

describe('caseService', () => {
    describe('transformPayload', () => {
        it('should transform a valid CloudEvents payload', () => {
            const payload = {
                data: {
                    crn: 'crn1',
                    sbi: 'sbi1',
                    crm: { title: 'Test Title' },
                    file: { fileName: 'file.pdf', url: 'http://file' },
                    correlationId: 'corr-1'
                }
            }
            const result = transformPayload(payload)
            expect(result.crn).toBe('crn1')
            expect(result.sbi).toBe('sbi1')
            expect(result.caseData.title).toBe('Test Title')
            expect(result.caseData.caseDescription).toContain('file.pdf')
            expect(result.onlineSubmissionActivity.subject).toContain('file.pdf')
        })

        it('should throw if data is missing', () => {
            expect(() => transformPayload({})).toThrow('Missing data property in CloudEvents payload')
        })
    })

    describe('createCase', () => {
        it('should call dependencies and return response', async () => {
            const payload = {
                data: {
                    crn: 'crn1',
                    sbi: 'sbi1',
                    crm: { title: 'Test Title' },
                    file: { fileName: 'file.pdf', url: 'http://file' },
                    correlationId: 'corr-1'
                }
            }
            const response = await caseService.createCase(payload)
            expect(response.caseId).toBe('mock-case-id')
        })

        it('should log and throw on error', async () => {
            const error = new Error('fail')
            const mod = await import('../../../src/services/create-case-with-online-submission-in-crm.js')
            vi.mocked(mod.createCaseWithOnlineSubmissionInCrm).mockRejectedValueOnce(error)
            await expect(caseService.createCase({ data: { crn: 'a', sbi: 'b', crm: {}, file: {}, correlationId: 'c' } })).rejects.toThrow('fail')
        })
    })
})
