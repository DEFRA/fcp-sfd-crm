import { describe, test, expect } from 'vitest'

import { toLogSafeUrl } from '../../../src/http/log-safe-url.js'

const base = 'https://crm.example.gov.uk/api/data/v9.2'

describe('toLogSafeUrl', () => {
  test('masks the CRN in a contact lookup filter', () => {
    const url = `${base}/contacts?$select=contactid&$filter=${encodeURIComponent("rpa_capcustomerid eq '1050000001'")}`

    const result = toLogSafeUrl(url)

    expect(result).toContain('******0001')
    expect(result).not.toContain('1050000001')
  })

  test('masks the SBI in an account lookup filter', () => {
    const url = `${base}/accounts?$select=accountid&$filter=${encodeURIComponent("rpa_sbinumber eq '123456789'")}`

    const result = toLogSafeUrl(url)

    expect(result).toContain('*****6789')
    expect(result).not.toContain('123456789')
  })

  test('masks every operand when a filter has multiple quoted literals', () => {
    const filter = "rpa_capcustomerid eq '1050000001' and rpa_sbinumber eq '123456789'"
    const url = `${base}/contacts?$filter=${encodeURIComponent(filter)}`

    const result = toLogSafeUrl(url)

    expect(result).not.toContain('1050000001')
    expect(result).not.toContain('123456789')
    expect(result).toContain('******0001')
    expect(result).toContain('*****6789')
  })

  test('preserves the field name and operator so the filter stays diagnosable', () => {
    const url = `${base}/contacts?$filter=${encodeURIComponent("rpa_capcustomerid eq '1050000001'")}`

    const result = toLogSafeUrl(url)

    expect(new URL(result).searchParams.get('$filter')).toBe("rpa_capcustomerid eq '******0001'")
  })

  test('re-serialises the query when it masks, so the value must be read back as a query param', () => {
    const url = `${base}/contacts?$select=contactid&$filter=${encodeURIComponent("rpa_capcustomerid eq '1050000001'")}`

    const params = new URL(toLogSafeUrl(url)).searchParams

    expect(params.get('$select')).toBe('contactid')
    expect(params.get('$filter')).toBe("rpa_capcustomerid eq '******0001'")
  })

  test('leaves a URL with no query string untouched', () => {
    const url = `${base}/contacts`

    expect(toLogSafeUrl(url)).toBe(url)
  })

  test('leaves a query string without a $filter untouched', () => {
    const url = `${base}/contacts?$select=contactid`

    expect(toLogSafeUrl(url)).toBe(url)
  })

  test('leaves an empty filter untouched rather than re-serialising the query', () => {
    const url = `${base}/contacts?$filter=`

    expect(toLogSafeUrl(url)).toBe(url)
  })

  test('drops the query string when the URL cannot be parsed', () => {
    const result = toLogSafeUrl("not-a-url?$filter=rpa_capcustomerid eq '1050000001'")

    expect(result).toBe('not-a-url')
    expect(result).not.toContain('1050000001')
  })

  test('returns a parse failure without a query string unchanged', () => {
    expect(toLogSafeUrl('not-a-url')).toBe('not-a-url')
  })
})
