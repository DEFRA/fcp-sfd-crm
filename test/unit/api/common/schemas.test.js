import { describe, it, expect } from 'vitest'
import Joi from 'joi'
import {
    createCasePayloadSchema,
    inboundCloudEventSchema,
    receivedEventSchema,
    validationOptions
} from '../../../../src/api/schemas/index.js'

describe('api/common/schemas', () => {
    it('createCasePayloadSchema accepts valid payload', () => {
        const valid = {
            caseType: 'some-type',
            crn: 'CRN123',
            sbi: 'SBI123',
            caseData: {
                title: 'Title',
                caseDescription: 'Description'
            },
            onlineSubmissionActivity: {
                subject: 'sub',
                description: 'desc',
                scheduledStart: new Date().toISOString(),
                scheduledEnd: new Date().toISOString(),
                stateCode: 1,
                statusCode: 2,
                metadata: {
                    name: 'file.pdf',
                    documentType: 'default',
                    blobFileId: 'blob-123'
                }
            }
        }

        const { error, value } = createCasePayloadSchema.validate(valid, validationOptions)
        expect(error).toBeUndefined()
        expect(value).toBeTruthy()
    })

    it('createCasePayloadSchema rejects missing required fields', () => {
        const invalid = {
            crn: 'CRN',
            sbi: 'SBI'
        }

        const { error } = createCasePayloadSchema.validate(invalid, validationOptions)
        expect(error).toBeTruthy()
        // should mention missing caseType and other fields
        expect(error.details.some(d => d.message.includes('caseType'))).toBeTruthy()
    })

    it('inboundCloudEventSchema accepts valid cloud event wrapper', () => {
        const validEvent = {
            id: '1',
            source: '/source',
            specversion: '1.0',
            type: 'type',
            datacontenttype: 'application/json',
            time: new Date().toISOString(),
            data: {
                crn: 'CRN',
                sbi: 'SBI',
                crm: {},
                file: {
                    fileId: 'file-1',
                    fileName: 'f.pdf'
                },
                correlationId: 'corr-1'
            }
        }

        const { error } = inboundCloudEventSchema.validate(validEvent, validationOptions)
        expect(error).toBeUndefined()
    })

    it('inboundCloudEventSchema rejects invalid data types', () => {
        const invalidEvent = {
            ...{
                id: '1',
                source: '/source',
                specversion: '1.0',
                type: 'type',
                datacontenttype: 'application/json',
                time: 'not-a-date',
                data: {
                    crn: 'CRN',
                    sbi: 'SBI',
                    file: {
                        fileId: 'file-1',
                        fileName: 'f.pdf'
                    },
                    correlationId: 'corr-1'
                }
            }
        }

        const { error } = inboundCloudEventSchema.validate(invalidEvent, validationOptions)
        expect(error).toBeTruthy()
        expect(error.details.some(d => d.message.includes('time'))).toBeTruthy()
    })

    it('receivedEventSchema accepts minimal valid received event', () => {
        const evt = {
            id: 'r1',
            source: '/src',
            specversion: '1.0',
            type: 'received',
            datacontenttype: 'application/json',
            time: new Date().toISOString(),
            data: {
                correlationId: 'cid',
                caseId: 'case-1',
                crn: '123',
                sbi: '456'
            }
        }

        const { error } = receivedEventSchema.validate(evt, validationOptions)
        expect(error).toBeUndefined()
    })

    it('receivedEventSchema rejects missing data.correlationId', () => {
        const evt = {
            id: 'r1',
            source: '/src',
            specversion: '1.0',
            type: 'received',
            datacontenttype: 'application/json',
            time: new Date().toISOString(),
            data: {}
        }

        const { error } = receivedEventSchema.validate(evt, validationOptions)
        expect(error).toBeTruthy()
        expect(error.details.some(d => d.message.includes('correlationId'))).toBeTruthy()
    })
})
