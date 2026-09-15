import { MongoClient } from 'mongodb'
import { config } from '../config/index.js'
import { createLogger } from '../logging/logger.js'

const logger = createLogger()

let dbInstance

// Connects using the secureContext decorated by the hapi plugin, once registered
const connectDb = async (secureContext) => {
  const client = await MongoClient.connect(config.get('mongo.uri'), {
    retryWrites: false,
    readPreference: 'secondary',
    ...(secureContext && { secureContext })
  })

  dbInstance = client.db(config.get('mongo.databaseName'))

  logger.info('Connected to MongoDB')

  return dbInstance
}

// Delegates to the connected instance so existing `import db from './db.js'` consumers keep working
const db = new Proxy({}, {
  get(_target, prop) {
    if (!dbInstance) {
      throw new Error('MongoDB has not been connected yet')
    }

    const value = dbInstance[prop]
    return typeof value === 'function' ? value.bind(dbInstance) : value
  }
})

export { connectDb }
export default db
