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
        file: { fileId: 'f1', fileName: 'file.pdf', url: 'https://example.com/api/v1/blobs/f1' },
        correlationId: 'corr-1',
        sourceSystem: 'fcp-sfd-frontend',
        submissionId: '3fa85f64-5717-4562-b3fc-2c963f66afa6'
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
