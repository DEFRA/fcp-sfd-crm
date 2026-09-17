import { maskIdentifier } from '../utils/mask-identifier.js'
import { CRN_FILTER_FIELDS } from '../constants/crm-fields.js'

const ODATA_FILTER_PARAM = '$filter'

// Only the CRN is masked. The SBI is logged in full, and the other filters
// (document type, for instance) carry nothing sensitive. Masking every quoted
// operand instead would need no list to maintain, but it would reinstate the
// SBI masking that was deliberately reverted.
//
// The field names come from the same constant the repo builds its filters with,
// so a CRN query cannot name a column this masker does not know about.

// Matches `<field> eq '<value>'` and captures the quoted value. The character
// class is bounded and cannot backtrack.
const crnOperandPattern = (field) => new RegExp(`(${field}\\s+eq\\s+')([^']*)(')`, 'gi')

const maskCrnOperands = (filter) =>
  CRN_FILTER_FIELDS.reduce(
    (masked, field) => masked.replaceAll(
      crnOperandPattern(field),
      (_match, prefix, value, suffix) => `${prefix}${maskIdentifier(value)}${suffix}`
    ),
    filter
  )

// Everything before the first '?' is safe: identifiers only ever reach the URL
// through the query string. Used when the URL cannot be parsed.
const dropQueryString = (url) => String(url).split('?')[0]

// The CRN is passed to Dataverse in the query string, and the retry decision,
// terminal failure and recovery logs all record the request URL. Security treat
// the CRN as half a login credential, so it must never be logged in full.
export const toLogSafeUrl = (url) => {
  let parsed

  try {
    parsed = new URL(url)
  } catch {
    return dropQueryString(url)
  }

  const filter = parsed.searchParams.get(ODATA_FILTER_PARAM)

  // Covers both an absent filter and an empty one.
  if (!filter) {
    return url
  }

  const masked = maskCrnOperands(filter)

  // Returning the original string keeps the logged URL byte-identical to the
  // one requested. Parsing alone would normalise its percent-encoding, and
  // writing back through searchParams re-serialises the whole query.
  if (masked === filter) {
    return url
  }

  parsed.searchParams.set(ODATA_FILTER_PARAM, masked)

  return parsed.toString()
}
