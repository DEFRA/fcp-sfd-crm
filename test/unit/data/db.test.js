import { describe, test, beforeEach, vi, expect } from 'vitest'

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  close: vi.fn(),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn()
}))

vi.mock('mongodb', () => ({
  MongoClient: {
    connect: mocks.connect
  }
}))

vi.mock('../../../src/config/index.js', () => ({
  config: {
    get: vi.fn().mockImplementation((key) => {
      if (key === 'mongo.uri') return 'mongodb://localhost:27017'
      if (key === 'mongo.databaseName') return 'fcp-sfd-crm'
    })
  }
}))

vi.mock('../../../src/logging/logger.js', () => ({
  createLogger: () => ({
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn
  })
}))

const importDb = () => import('../../../src/data/db.js')

const connect = async (secureContext) => {
  const dbModule = await importDb()
  await dbModule.connectDb(secureContext)
  return dbModule
}

describe('data/db', () => {
  let mockDb
  let mockClient

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    mockDb = {
      collection: vi.fn().mockReturnThis(),
      someProp: 'value'
    }
    mockClient = { db: vi.fn().mockReturnValue(mockDb), close: mocks.close }
    mocks.connect.mockResolvedValue(mockClient)
    mocks.close.mockResolvedValue(undefined)
  })

  test('does not connect when the module is imported', async () => {
    await importDb()

    expect(mocks.connect).not.toHaveBeenCalled()
  })

  test('connectDb connects to the configured database without a secure context when none is supplied', async () => {
    await connect()

    expect(mocks.connect).toHaveBeenCalledWith('mongodb://localhost:27017', {
      retryWrites: false,
      readPreference: 'secondary'
    })
    expect(mocks.connect.mock.calls[0][1]).not.toHaveProperty('secureContext')
    expect(mockClient.db).toHaveBeenCalledWith('fcp-sfd-crm')
    expect(mocks.loggerInfo).toHaveBeenCalledWith('Connected to MongoDB')
  })

  test('connectDb passes the secure context through when supplied', async () => {
    const secureContext = { some: 'context' }

    await connect(secureContext)

    expect(mocks.connect).toHaveBeenCalledWith('mongodb://localhost:27017', {
      retryWrites: false,
      readPreference: 'secondary',
      secureContext
    })
  })

  test('connectDb rejects and leaves the db unusable when the connection fails', async () => {
    const connectionError = new Error('connection refused')
    mocks.connect.mockRejectedValue(connectionError)
    const { connectDb, default: db } = await importDb()

    await expect(connectDb()).rejects.toThrow(connectionError)
    expect(() => db.collection('test')).toThrow('MongoDB has not been connected yet')
  })

  test('connectDb keeps the existing connection when called again', async () => {
    const { connectDb, default: db } = await connect()

    await connectDb()

    expect(mocks.connect).toHaveBeenCalledTimes(1)
    expect(db.someProp).toBe('value')
    expect(mocks.loggerWarn).not.toHaveBeenCalled()
  })

  test('connectDb warns that a secure context was ignored when the connection is already open', async () => {
    const { connectDb } = await connect()

    await connectDb({ some: 'context' })

    expect(mocks.connect).toHaveBeenCalledTimes(1)
    expect(mocks.loggerWarn).toHaveBeenCalledWith({
      event: {
        type: 'mongo_connect',
        action: 'connect',
        outcome: 'success',
        reason: 'connection already open, supplied secure context ignored'
      }
    }, 'connectDb called with a secure context after the connection was opened')
  })

  test('closeDb closes the client and clears the connection', async () => {
    const { closeDb, default: db } = await connect()

    await closeDb()

    expect(mocks.close).toHaveBeenCalledTimes(1)
    expect(() => db.collection('test')).toThrow('MongoDB has not been connected yet')
  })

  test('closeDb does nothing when there is no connection', async () => {
    const { closeDb } = await importDb()

    await expect(closeDb()).resolves.toBeUndefined()
    expect(mocks.close).not.toHaveBeenCalled()
  })

  test('closeDb logs and swallows an error from closing the client', async () => {
    const closeError = new Error('close failed')
    mocks.close.mockRejectedValue(closeError)
    const { closeDb, default: db } = await connect()

    await expect(closeDb()).resolves.toBeUndefined()
    expect(mocks.loggerWarn).toHaveBeenCalledWith({
      err: closeError,
      event: { type: 'mongo_close', action: 'close', outcome: 'failure' }
    }, 'Failed to close the MongoDB client')
    expect(() => db.collection('test')).toThrow('MongoDB has not been connected yet')
  })

  test('connectDb opens a new connection after closeDb', async () => {
    const { connectDb, closeDb } = await connect()
    await closeDb()

    await connectDb()

    expect(mocks.connect).toHaveBeenCalledTimes(2)
  })

  test('default db export throws when accessed before connectDb has resolved', async () => {
    const { default: db } = await importDb()

    expect(() => db.collection('test')).toThrow('MongoDB has not been connected yet')
  })

  test('default db export delegates property access to the connected instance', async () => {
    const { default: db } = await connect()

    expect(db.someProp).toBe('value')
  })

  test('default db export binds method calls to the connected instance', async () => {
    const { default: db } = await connect()

    const result = db.collection('test')

    expect(mockDb.collection).toHaveBeenCalledWith('test')
    expect(result).toBe(mockDb)
  })
})
