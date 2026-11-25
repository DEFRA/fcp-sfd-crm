import { describe, test, expect } from 'vitest'
import { toTenantMessage, sanitizeSourceSystem } from '../../../src/logging/tenant-message.js'
import { ALLOWED_SOURCE_SYSTEMS } from '../../../src/constants/source-systems.js'

describe('toTenantMessage', () => {
  test('joins entries as key=value pairs separated by spaces', () => {
    expect(toTenantMessage({ fileId: 'f1', attempts: 2 })).toBe('fileId=f1 attempts=2')
  })

  test('omits null values', () => {
    expect(toTenantMessage({ fileId: 'f1', cause: null })).toBe('fileId=f1')
  })

  test('omits undefined values', () => {
    expect(toTenantMessage({ fileId: 'f1', cause: undefined })).toBe('fileId=f1')
  })

  test('returns null for an empty object', () => {
    expect(toTenantMessage({})).toBeNull()
  })

  test('returns null when every value is null or undefined', () => {
    expect(toTenantMessage({ a: null, b: undefined })).toBeNull()
  })

  test('preserves falsy-but-present values such as 0 and empty string', () => {
    expect(toTenantMessage({ attempts: 0, note: '' })).toBe('attempts=0 note=')
  })
})

describe('sanitizeSourceSystem', () => {
  test('returns fcp-sfd-frontend unchanged', () => {
    expect(sanitizeSourceSystem('fcp-sfd-frontend')).toBe('fcp-sfd-frontend')
  })

  test('returns rps-portal unchanged', () => {
    expect(sanitizeSourceSystem('rps-portal')).toBe('rps-portal')
  })

  test('allows only fcp-sfd-frontend and rps-portal', () => {
    expect(ALLOWED_SOURCE_SYSTEMS).toEqual(['fcp-sfd-frontend', 'rps-portal'])
  })

  test('returns undefined for a source system that is not on the allow list', () => {
    expect(sanitizeSourceSystem('qa-new-source')).toBeUndefined()
    expect(sanitizeSourceSystem('unknown-service')).toBeUndefined()
  })

  test('returns undefined for an allow-listed value in a different case', () => {
    expect(sanitizeSourceSystem('FCP-SFD-FRONTEND')).toBeUndefined()
  })

  test('returns undefined when the value contains whitespace', () => {
    expect(sanitizeSourceSystem('rps portal')).toBeUndefined()
    expect(sanitizeSourceSystem('rps-portal\n')).toBeUndefined()
    expect(sanitizeSourceSystem(' rps-portal')).toBeUndefined()
  })

  test('returns undefined when the value contains "=", so it cannot forge a second pair', () => {
    expect(sanitizeSourceSystem('sourceSystem=fcp-sfd-frontend')).toBeUndefined()
    expect(toTenantMessage({ sourceSystem: sanitizeSourceSystem('evil sourceSystem=fcp-sfd-frontend') })).toBeNull()
  })

  test('returns undefined when an allow-listed value is followed by a forged pair', () => {
    expect(sanitizeSourceSystem('rps-portal sourceSystem=fcp-sfd-frontend')).toBeUndefined()
  })

  test('returns undefined when the value is an array holding an allow-listed value', () => {
    expect(sanitizeSourceSystem(['fcp-sfd-frontend'])).toBeUndefined()
  })

  test('returns undefined when the value is an empty string', () => {
    expect(sanitizeSourceSystem('')).toBeUndefined()
  })

  test('returns undefined when the value is missing', () => {
    expect(sanitizeSourceSystem(undefined)).toBeUndefined()
  })

  test('returns undefined when the value is null', () => {
    expect(sanitizeSourceSystem(null)).toBeUndefined()
  })

  test('returns undefined when the value is not a string', () => {
    expect(sanitizeSourceSystem(123)).toBeUndefined()
    expect(sanitizeSourceSystem({})).toBeUndefined()
    expect(sanitizeSourceSystem(true)).toBeUndefined()
  })

  test('combines with toTenantMessage to omit the pair rather than rendering "sourceSystem=undefined"', () => {
    expect(toTenantMessage({ fileId: 'f1', sourceSystem: sanitizeSourceSystem(42) })).toBe('fileId=f1')
    expect(toTenantMessage({ fileId: 'f1', sourceSystem: sanitizeSourceSystem('qa-new-source') })).toBe('fileId=f1')
    expect(toTenantMessage({ fileId: 'f1', sourceSystem: sanitizeSourceSystem('rps-portal') })).toBe('fileId=f1 sourceSystem=rps-portal')
  })
})
