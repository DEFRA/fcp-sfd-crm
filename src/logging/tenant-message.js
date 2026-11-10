// CDP only indexes a fixed subset of ECS fields, so any additional context is
// carried in tenant.message rather than emitted as bespoke top-level keys.
// See cdp-documentation/how-to/logging.md for the allow-list.
const toTenantMessage = (context) => {
  const entries = Object.entries(context).filter(([, value]) => value !== null && value !== undefined)
  return entries.length ? entries.map(([key, value]) => `${key}=${value}`).join(' ') : null
}

// A source system that is missing or not a string must be omitted from tenant.message
// rather than rendered as "sourceSystem=undefined". Some log sites read the value before
// schema validation has passed, and toTenantMessage does not escape values, so a value
// containing whitespace or "=" (for example "a sourceSystem=b") is also omitted rather
// than allowed to forge a second pair. New source systems need no change here.
const SOURCE_SYSTEM_PATTERN = /^[^\s=]+$/

const sanitizeSourceSystem = (value) =>
  typeof value === 'string' && SOURCE_SYSTEM_PATTERN.test(value) ? value : undefined

export { toTenantMessage, sanitizeSourceSystem }
