import { describe, test, expect } from 'vitest'
import {
  auditEntities,
  auditActions,
  auditStatuses,
  auditFailureReasons,
  securityPmcCodes,
  auditLogEventType,
  auditLogReasons
} from '../../../src/constants/audit.js'

describe('src/constants/audit.js', () => {
  test('exposes the canonical entity literals', () => {
    expect(auditEntities).toEqual({
      PERSON: 'person',
      BUSINESS: 'business',
      DOCUMENT: 'document',
      SERVICE: 'service'
    })
  })

  test('exposes the canonical action literals', () => {
    expect(auditActions).toEqual({
      READ: 'read',
      CREATED: 'created',
      AUTHENTICATE: 'authenticate'
    })
  })

  test('exposes the canonical status literals', () => {
    expect(auditStatuses).toEqual({
      SUCCESS: 'success',
      FAILURE: 'failure'
    })
  })

  test('exposes not-found failure reasons', () => {
    expect(auditFailureReasons).toEqual({
      CRN_NOT_FOUND: 'CRN not found',
      SBI_NOT_FOUND: 'SBI not found'
    })
  })

  test('exposes the security event pmccodes', () => {
    expect(securityPmcCodes).toEqual({
      CREDENTIAL_FAILURE: 'AUTH'
    })
  })

  test('exposes the audit publish failure log type', () => {
    expect(auditLogEventType).toBe('audit_publish_failed')
  })

  test('exposes the audit publish failure reason classifications', () => {
    expect(auditLogReasons).toEqual({
      SCHEMA_VALIDATION: 'schema_validation',
      TRANSPORT: 'transport',
      UNEXPECTED: 'unexpected'
    })
  })
})
