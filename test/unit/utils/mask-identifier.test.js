import { describe, test, expect } from 'vitest'

import { maskIdentifier } from '../../../src/utils/mask-identifier.js'

describe('maskIdentifier', () => {
  test('masks all but the last four digits of a 10-digit CRN', () => {
    expect(maskIdentifier('1050000001')).toBe('******0001')
  })

  test('works when CRN is passed as a number', () => {
    expect(maskIdentifier(1050000001)).toBe('******0001')
  })

  test('returns string as-is when length is exactly 4', () => {
    expect(maskIdentifier('0001')).toBe('0001')
  })

  test('returns string as-is when length is less than 4', () => {
    expect(maskIdentifier('abc')).toBe('abc')
  })

  test('returns **** for null', () => {
    expect(maskIdentifier(null)).toBe('****')
  })

  test('returns **** for undefined', () => {
    expect(maskIdentifier(undefined)).toBe('****')
  })
})
