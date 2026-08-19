import { describe, test, expect } from 'vitest'
import { toTenantMessage } from '../../../src/logging/tenant-message.js'

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
