import { describe, it, expect } from 'vitest'
import { receivedEventSchema, validationOptions } from '../../../../src/api/schemas/outbound.js'

describe('Outbound received event schema validation', () => {
    it('accepts a valid received event payload', () => {
        const valid = {
            id: 'evt-1',
            source: '/fcp-sfd-crm',
            specversion: '1.0',
            type: 'crm.case.created',
            datacontenttype: 'application/json',
            time: new Date().toISOString(),
            data: { correlationId: 'corr-1', caseId: 'case-1' }
        }

        const { error } = receivedEventSchema.validate(valid, validationOptions)
        expect(error).toBeUndefined()
    })

    it('rejects invalid received event payloads', () => {
        const invalid = { not: 'valid' }
        const { error } = receivedEventSchema.validate(invalid, validationOptions)
        expect(error).toBeDefined()
        expect(Array.isArray(error.details)).toBe(true)
    })
})
