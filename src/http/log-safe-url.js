import { maskIdentifier } from '../utils/mask-identifier.js'

const ODATA_FILTER_PARAM = '$filter'

// OData filters hold their operands as single-quoted literals, for example
// `rpa_capcustomerid eq '1050000001'`. Matching the quotes rather than the
// field names means a new lookup cannot leak an identifier simply because
// nobody remembered to add its column to an allow list.
// The character class is bounded and cannot backtrack.
const QUOTED_LITERAL = /'([^']*)'/g

const maskQuotedLiterals = (filter) =>
  filter.replaceAll(QUOTED_LITERAL, (_match, value) => `'${maskIdentifier(value)}'`)

// Everything before the first '?' is safe: identifiers only ever reach the URL
// through the query string. Used when the URL cannot be parsed.
const dropQueryString = (url) => String(url).split('?')[0]

// CRN and SBI are passed to Dataverse in the query string, and both the retry
// decision log and the terminal failure log record the request URL. Security
// treat the CRN as half a login credential, so it must never be logged in full;
// the SBI is masked on the same terms. This masks every filter operand so the
// URL stays useful for diagnosis without carrying the raw values.
export const toLogSafeUrl = (url) => {
  let parsed

  try {
    parsed = new URL(url)
  } catch {
    return dropQueryString(url)
  }

  const filter = parsed.searchParams.get(ODATA_FILTER_PARAM)

  // Covers both an absent filter and an empty one. Writing back through
  // searchParams re-serialises the whole query, so it is worth skipping when
  // there is nothing to mask.
  if (!filter) {
    return parsed.toString()
  }

  parsed.searchParams.set(ODATA_FILTER_PARAM, maskQuotedLiterals(filter))

  return parsed.toString()
}
