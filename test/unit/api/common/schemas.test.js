import { describe, it, expect } from 'vitest'
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
          fileId: '9fcaabe5-77ec-44db-8356-3a6e8dc51b13',
          fileName: 'f.pdf',
          url: 'https://example.com/api/v1/blobs/9fcaabe5-77ec-44db-8356-3a6e8dc51b13'
        },
        correlationId: '550e8400-e29b-41d4-a716-446655440000',
        sourceSystem: 'fcp-sfd-frontend',
        submissionId: '3fa85f64-5717-4562-b3fc-2c963f66afa6'
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
            fileId: '9fcaabe5-77ec-44db-8356-3a6e8dc51b13',
            fileName: 'f.pdf',
            url: 'https://example.com/api/v1/blobs/9fcaabe5-77ec-44db-8356-3a6e8dc51b13'
          },
          correlationId: '550e8400-e29b-41d4-a716-446655440000',
          sourceSystem: 'fcp-sfd-frontend',
          submissionId: '3fa85f64-5717-4562-b3fc-2c963f66afa6'
        }
      }
    }

    const { error } = inboundCloudEventSchema.validate(invalidEvent, validationOptions)
    expect(error).toBeTruthy()
    expect(error.details.some(d => d.message.includes('time'))).toBeTruthy()
  })

  it('receivedEventSchema accepts minimal valid received event', () => {
    const evt = {
      id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      source: 'fcp-sfd-crm',
      specversion: '1.0',
      type: 'uk.gov.fcp.sfd.crm.case.created',
      datacontenttype: 'application/json',
      time: new Date().toISOString(),
      data: {
        correlationId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        caseId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        crn: 1050000000,
        sbi: 105000000
      }
    }

    const { error } = receivedEventSchema.validate(evt, validationOptions)
    expect(error).toBeUndefined()
  })

  it('receivedEventSchema accepts event with caseType and onlineSubmissionActivities', () => {
    const evt = {
      id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      source: 'fcp-sfd-crm',
      specversion: '1.0',
      type: 'uk.gov.fcp.sfd.crm.case.created',
      datacontenttype: 'application/json',
      time: new Date().toISOString(),
      data: {
        correlationId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        caseId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        crn: 1050000000,
        sbi: 105000000,
        caseType: 'case-created',
        onlineSubmissionActivities: [{
          id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          fileId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          time: new Date().toISOString()
        }]
      }
    }

    const { error } = receivedEventSchema.validate(evt, validationOptions)
    expect(error).toBeUndefined()
  })

  it('receivedEventSchema rejects non-UUID id', () => {
    const evt = {
      id: 'not-a-uuid',
      source: 'fcp-sfd-crm',
      specversion: '1.0',
      type: 'uk.gov.fcp.sfd.crm.case.created',
      datacontenttype: 'application/json',
      time: new Date().toISOString(),
      data: {
        correlationId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        caseId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        crn: 1050000000,
        sbi: 105000000
      }
    }

    const { error } = receivedEventSchema.validate(evt, validationOptions)
    expect(error).toBeTruthy()
    expect(error.details.some(d => d.message.includes('"id"'))).toBeTruthy()
  })

  it('receivedEventSchema rejects invalid specversion', () => {
    const evt = {
      id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      source: 'fcp-sfd-crm',
      specversion: '2.0',
      type: 'uk.gov.fcp.sfd.crm.case.created',
      datacontenttype: 'application/json',
      time: new Date().toISOString(),
      data: {
        correlationId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        caseId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        crn: 1050000000,
        sbi: 105000000
      }
    }

    const { error } = receivedEventSchema.validate(evt, validationOptions)
    expect(error).toBeTruthy()
    expect(error.details.some(d => d.message.includes('specversion'))).toBeTruthy()
  })

  it('receivedEventSchema rejects invalid event type', () => {
    const evt = {
      id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      source: 'fcp-sfd-crm',
      specversion: '1.0',
      type: 'uk.gov.fcp.sfd.crm.case.deleted',
      datacontenttype: 'application/json',
      time: new Date().toISOString(),
      data: {
        correlationId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        caseId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        crn: 1050000000,
        sbi: 105000000
      }
    }

    const { error } = receivedEventSchema.validate(evt, validationOptions)
    expect(error).toBeTruthy()
    expect(error.details.some(d => d.message.includes('type'))).toBeTruthy()
  })

  it('receivedEventSchema rejects unknown properties on root', () => {
    const evt = {
      id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      source: 'fcp-sfd-crm',
      specversion: '1.0',
      type: 'uk.gov.fcp.sfd.crm.case.created',
      datacontenttype: 'application/json',
      time: new Date().toISOString(),
      unexpected: 'field',
      data: {
        correlationId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        caseId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        crn: 1050000000,
        sbi: 105000000
      }
    }

    const { error } = receivedEventSchema.validate(evt, validationOptions)
    expect(error).toBeTruthy()
    expect(error.details.some(d => d.message.includes('unexpected'))).toBeTruthy()
  })

  it('receivedEventSchema rejects unknown properties on data', () => {
    const evt = {
      id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      source: 'fcp-sfd-crm',
      specversion: '1.0',
      type: 'uk.gov.fcp.sfd.crm.case.created',
      datacontenttype: 'application/json',
      time: new Date().toISOString(),
      data: {
        correlationId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        caseId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        crn: 1050000000,
        sbi: 105000000,
        extraField: 'not-allowed'
      }
    }

    const { error } = receivedEventSchema.validate(evt, validationOptions)
    expect(error).toBeTruthy()
    expect(error.details.some(d => d.message.includes('extraField'))).toBeTruthy()
  })

  it('receivedEventSchema rejects missing data.correlationId', () => {
    const evt = {
      id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      source: 'fcp-sfd-crm',
      specversion: '1.0',
      type: 'uk.gov.fcp.sfd.crm.case.created',
      datacontenttype: 'application/json',
      time: new Date().toISOString(),
      data: {
        caseId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        crn: 1050000000,
        sbi: 105000000
      }
    }

    const { error } = receivedEventSchema.validate(evt, validationOptions)
    expect(error).toBeTruthy()
    expect(error.details.some(d => d.message.includes('correlationId'))).toBeTruthy()
  })
})
