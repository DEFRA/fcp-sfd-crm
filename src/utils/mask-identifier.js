const MASK_VISIBLE_DIGITS = 4
const NULL_IDENTIFIER_MASK = '*'.repeat(MASK_VISIBLE_DIGITS)

// Generic identifier masker: safe for CRN, SBI or any other numeric/text
// identifier where only the last few digits should be logged. Security treat
// the CRN as half a login credential, so it must never appear in full in logs.
// For a sole trader the SBI is effectively a personal identifier, so it is
// masked on the same terms as the CRN.
export function maskIdentifier (identifier) {
  if (identifier === null || identifier === undefined) { return NULL_IDENTIFIER_MASK }
  const str = String(identifier)
  if (str.length <= MASK_VISIBLE_DIGITS) { return str }
  return '*'.repeat(str.length - MASK_VISIBLE_DIGITS) + str.slice(-MASK_VISIBLE_DIGITS)
}
