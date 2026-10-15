import { connectDb } from '../data/db.js'

// Must be registered after the secureContext plugin, which decorates
// server.secureContext with the TRUSTSTORE_ CA certificates that the MongoDB
// TLS connection relies on.
const mongoDb = {
  plugin: {
    name: 'mongodb',
    register: async (server) => {
      await connectDb(server.secureContext)
    }
  }
}

export { mongoDb }
