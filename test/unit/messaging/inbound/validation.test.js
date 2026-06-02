import { describe, it, expect } from 'vitest'
import { inboundCloudEventSchema, validationOptions } from '../../../../src/api/schemas/inbound.js'

describe('Inbound CloudEvent schema validation', () => {
    it('accepts a valid CloudEvent payload', () => {
        const valid = {
            id: '1',
            source: '/test',
            specversion: '1.0',
            type: 'test.type',
            datacontenttype: 'application/json',
            time: new Date().toISOString(),
            data: {
                crn: '123',
                sbi: '321',
                file: { fileId: 'f1', fileName: 'file.pdf' },
                correlationId: 'corr-1'
            }
        }

        const { error } = inboundCloudEventSchema.validate(valid, validationOptions)
        expect(error).toBeUndefined()
    })

    it('rejects invalid CloudEvent payloads', () => {
        const invalid = { foo: 'bar' }
        const { error } = inboundCloudEventSchema.validate(invalid, validationOptions)
        expect(error).toBeDefined()
        expect(Array.isArray(error.details)).toBe(true)
    })
})
