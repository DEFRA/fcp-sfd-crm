const MASK_VISIBLE_DIGITS = 4
const NULL_IDENTIFIER_MASK = '*'.repeat(MASK_VISIBLE_DIGITS)

// Masks a CRN so only the last few digits are logged, because the CRN is
// half of a login credential. The SBI is logged in full.
export function maskIdentifier (identifier) {
  if (identifier === null || identifier === undefined) { return NULL_IDENTIFIER_MASK }
  const str = String(identifier)
  if (str.length <= MASK_VISIBLE_DIGITS) { return str }
  return '*'.repeat(str.length - MASK_VISIBLE_DIGITS) + str.slice(-MASK_VISIBLE_DIGITS)
}
