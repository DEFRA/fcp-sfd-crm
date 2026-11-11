import { describe, test, expect } from 'vitest'
import { toTenantMessage, sanitizeSourceSystem } from '../../../src/logging/tenant-message.js'

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
  test('returns the value unchanged when it is a string', () => {
    expect(sanitizeSourceSystem('fcp-sfd-frontend')).toBe('fcp-sfd-frontend')
  })

  test('accepts a source system not yet known to this service', () => {
    expect(sanitizeSourceSystem('new-source-system')).toBe('new-source-system')
  })

  test('returns undefined when the value contains whitespace', () => {
    expect(sanitizeSourceSystem('rps portal')).toBeUndefined()
    expect(sanitizeSourceSystem('rps-portal\n')).toBeUndefined()
  })

  test('returns undefined when the value contains "=", so it cannot forge a second pair', () => {
    expect(sanitizeSourceSystem('sourceSystem=fcp-sfd-frontend')).toBeUndefined()
    expect(toTenantMessage({ sourceSystem: sanitizeSourceSystem('evil sourceSystem=fcp-sfd-frontend') })).toBeNull()
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
    expect(toTenantMessage({ fileId: 'f1', sourceSystem: sanitizeSourceSystem('rps-portal') })).toBe('fileId=f1 sourceSystem=rps-portal')
  })
})
