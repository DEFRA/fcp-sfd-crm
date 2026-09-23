import { describe, test, beforeEach, vi, expect } from 'vitest'

const mockConnect = vi.fn()

vi.mock('mongodb', () => ({
    MongoClient: {
        connect: (...args) => mockConnect(...args)
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

const mockLoggerInfo = vi.fn()
vi.mock('../../../src/logging/logger.js', () => ({
    createLogger: () => ({ info: mockLoggerInfo })
}))

describe('db', () => {
    let mockDb
    let mockClient

    beforeEach(() => {
        vi.clearAllMocks()
        vi.resetModules()

        mockDb = {
            collection: vi.fn().mockReturnThis(),
            someProp: 'value'
        }
        mockClient = { db: vi.fn().mockReturnValue(mockDb) }
        mockConnect.mockResolvedValue(mockClient)
    })

    test('connectDb connects to Mongo and returns the database instance', async () => {
        const { connectDb } = await import('../../../src/data/db.js')

        const result = await connectDb()

        expect(mockConnect).toHaveBeenCalledWith('mongodb://localhost:27017', {
            retryWrites: false,
            readPreference: 'secondary'
        })
        expect(mockClient.db).toHaveBeenCalledWith('fcp-sfd-crm')
        expect(result).toBe(mockDb)
        expect(mockLoggerInfo).toHaveBeenCalledWith('Connected to MongoDB')
    })

    test('connectDb passes the secureContext through when provided', async () => {
        const { connectDb } = await import('../../../src/data/db.js')
        const secureContext = { some: 'context' }

        await connectDb(secureContext)

        expect(mockConnect).toHaveBeenCalledWith('mongodb://localhost:27017', {
            retryWrites: false,
            readPreference: 'secondary',
            secureContext
        })
    })

    test('db proxy throws when accessed before connectDb has resolved', async () => {
        const { default: db } = await import('../../../src/data/db.js')

        expect(() => db.collection('test')).toThrow('MongoDB has not been connected yet')
    })

    test('db proxy delegates property access to the connected instance', async () => {
        const { connectDb, default: db } = await import('../../../src/data/db.js')

        await connectDb()

        expect(db.someProp).toBe('value')
    })

    test('db proxy delegates and binds method calls to the connected instance', async () => {
        const { connectDb, default: db } = await import('../../../src/data/db.js')

        await connectDb()
        const result = db.collection('test')

        expect(mockDb.collection).toHaveBeenCalledWith('test')
        expect(result).toBe(mockDb)
    })
})
