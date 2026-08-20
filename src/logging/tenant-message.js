// CDP only indexes a fixed subset of ECS fields, so any additional context is
// carried in tenant.message rather than emitted as bespoke top-level keys.
// See cdp-documentation/how-to/logging.md for the allow-list.
const toTenantMessage = (context) => {
  const entries = Object.entries(context).filter(([, value]) => value !== null && value !== undefined)
  return entries.length ? entries.map(([key, value]) => `${key}=${value}`).join(' ') : null
}

export { toTenantMessage }
