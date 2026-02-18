import { describe, test, expect, vi, beforeEach } from 'vitest'

const mockLogger = { info: vi.fn(), error: vi.fn() }

vi.mock('../../../src/logging/logger.js', () => ({
  createLogger: () => mockLogger
}))

const { createIndex } = await import('../../../src/data/create-index.js')

describe('createIndex', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('should create index with params and log success', async () => {
    const mockCollection = {
      createIndex: vi.fn().mockResolvedValue()
    }

    await createIndex(mockCollection, { correlationId: 1 }, 'correlationId_1', true)

    expect(mockCollection.createIndex).toHaveBeenCalledWith(
      { correlationId: 1 },
      { unique: true, name: 'correlationId_1' }
    )
    expect(mockLogger.info).toHaveBeenCalledWith('Index has been created: correlationId_1')
  })

  test('should create non-unique index with unique default false', async () => {
    const mockCollection = {
      createIndex: vi.fn().mockResolvedValue()
    }

    await createIndex(mockCollection, { field: 1 }, 'field_1')

    expect(mockCollection.createIndex).toHaveBeenCalledWith(
      { field: 1 },
      { unique: false, name: 'field_1' }
    )
    expect(mockLogger.info).toHaveBeenCalledWith('Index has been created: field_1')
  })

  test('should log error when createIndex fails', async () => {
    const mockCollection = {
      createIndex: vi.fn().mockRejectedValue(new Error('Index already exists'))
    }

    await createIndex(mockCollection, { correlationId: 1 }, 'correlationId_1', true)

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Unable to create index correlationId_1: Index already exists'
    )
  })
})
