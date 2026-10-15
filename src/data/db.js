import { MongoClient } from 'mongodb'
import { config } from '../config/index.js'

import { createLogger } from '../logging/logger.js'

const logger = createLogger()

const NOT_CONNECTED_MESSAGE = 'MongoDB has not been connected yet: connectDb must resolve before the db is used'

// Populated by connectDb(), which the mongoDb plugin calls after the secure
// context plugin has registered. Nothing connects when this module is imported.
const mongo = {}

/**
 * Connects to MongoDB once per process. Later calls keep the existing
 * connection, so a second caller cannot replace the client already in use.
 *
 * @param {import('node:tls').SecureContext} [secureContext] - decorated on the server by the secureContext plugin
 */
const connectDb = async (secureContext) => {
  if (mongo.client) {
    if (secureContext) {
      logger.warn({
        event: {
          type: 'crm.mongo.connect',
          action: 'connect',
          outcome: 'unknown',
          reason: 'connection already open, supplied secure context ignored'
        }
      }, 'connectDb called with a secure context after the connection was opened')
    }

    return
  }

  const client = await MongoClient.connect(config.get('mongo.uri'), {
    retryWrites: false,
    readPreference: 'secondary',
    ...(secureContext && { secureContext })
  })

  mongo.client = client
  mongo.db = client.db(config.get('mongo.databaseName'))

  logger.info('Connected to MongoDB')
}

/**
 * Closes the MongoDB client and clears the connection.
 */
const closeDb = async () => {
  const openClient = mongo.client

  mongo.client = null
  mongo.db = null

  try {
    await openClient?.close()
  } catch (error) {
    // Swallowed deliberately: this runs as hapi-pulse's postServerStop, which
    // exits the process with code 1 and skips preShutdown if a hook rejects.
    // A connection we are discarding anyway is not worth failing shutdown over.
    logger.warn({
      err: error,
      event: { type: 'crm.mongo.close', action: 'close', outcome: 'failure' }
    }, 'Failed to close the MongoDB client')
  }
}

// Repositories bind this at import, before connectDb has run, so each property
// read is forwarded to the Db instance connected at the time of the read.
// vi.spyOn(db, 'collection') has no effect on this export, because reads never
// reach the proxy target. Mock the module with vi.mock instead.
const db = new Proxy({}, {
  get (_target, property) {
    if (!mongo.db) {
      throw new Error(NOT_CONNECTED_MESSAGE)
    }

    const value = Reflect.get(mongo.db, property)

    return typeof value === 'function' ? value.bind(mongo.db) : value
  }
})

export { connectDb, closeDb }

export default db
