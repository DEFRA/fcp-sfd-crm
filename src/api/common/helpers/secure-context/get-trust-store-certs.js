const getTrustStoreCerts = (envsOrConfig) => {
  // If a convict `config` object is provided (has .get), prefer that
  if (envsOrConfig && typeof envsOrConfig.get === 'function') {
    try {
      const configured = envsOrConfig.get('truststore')
      if (Array.isArray(configured) && configured.length) {
        return configured.map((envValue) => Buffer.from(envValue, 'base64').toString().trim())
      }
    } catch (err) {
      // If the config key isn't present, fall back to scanning process.env
    }
    return Object.entries(process.env)
      .map(([key, value]) => key.startsWith('TRUSTSTORE_') && value)
      .filter(Boolean)
      .map((envValue) => Buffer.from(envValue, 'base64').toString().trim())
  }

  // Otherwise treat the argument as an env-like object (original behaviour)
  const envs = envsOrConfig || process.env
  return Object.entries(envs)
    .map(([key, value]) => key.startsWith('TRUSTSTORE_') && value)
    .filter(Boolean)
    .map((envValue) => Buffer.from(envValue, 'base64').toString().trim())
}

export { getTrustStoreCerts }
