import { ALLOWED_SOURCE_SYSTEMS } from '../constants/source-systems.js'

// CDP only indexes a fixed subset of ECS fields, so any additional context is
// carried in tenant.message rather than emitted as bespoke top-level keys.
// See cdp-documentation/how-to/logging.md for the allow-list.
const toTenantMessage = (context) => {
  const entries = Object.entries(context).filter(([, value]) => value !== null && value !== undefined)
  return entries.length ? entries.map(([key, value]) => `${key}=${value}`).join(' ') : null
}

// Some log sites read data.sourceSystem before schema validation has passed, and the
// schema accepts any string. toTenantMessage does not escape values, so a free-text value
// such as "a sourceSystem=b" would forge a second pair. Only values on the allow list are
// rendered. Anything else, including a missing or non-string value, is omitted rather
// than rendered as "sourceSystem=undefined". The message itself is still processed.
const sanitizeSourceSystem = (value) =>
  ALLOWED_SOURCE_SYSTEMS.includes(value) ? value : undefined

export { toTenantMessage, sanitizeSourceSystem }
