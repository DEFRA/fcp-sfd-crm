import { config } from '../config/index.js'

const TRUSTSTORE_PREFIX = 'TRUSTSTORE_'

// Must be registered after the secureContext plugin, which decorates
// server.customCACerts with only the TRUSTSTORE_ certificates it could parse.
// The library skips the others without logging, so startup stops here instead
// of failing later with a MongoDB or HTTPS handshake error.
const trustStoreCheck = {
  plugin: {
    name: 'trust-store-check',
    register: (server) => {
      const loadedKeys = Object.keys(server.customCACerts ?? {})

      const invalidKeys = Object.keys(process.env)
        .filter((key) => key.startsWith(TRUSTSTORE_PREFIX) && !loadedKeys.includes(key))

      if (invalidKeys.length) {
        throw new Error(`Invalid CA certificate in ${invalidKeys.join(', ')}`)
      }

      if (!loadedKeys.length && config.get('cdpEnvironment') !== 'local') {
        throw new Error(`No ${TRUSTSTORE_PREFIX} CA certificates were loaded`)
      }
    }
  }
}

export { trustStoreCheck }
