import { beforeEach, describe, expect, test, vi } from 'vitest'
import hapi from '@hapi/hapi'

import { connectDb } from '../../../src/data/db.js'
import { mongoDb } from '../../../src/plugins/mongodb.js'

vi.mock('../../../src/data/db.js', () => ({
  connectDb: vi.fn()
}))

describe('mongoDb plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('connects using the secure context decorated by an earlier plugin', async () => {
    const secureContext = { context: true }
    const server = hapi.server()
    server.decorate('server', 'secureContext', secureContext)

    await server.register(mongoDb)

    expect(connectDb).toHaveBeenCalledWith(secureContext)
  })

  test('connects without a secure context when none has been decorated', async () => {
    const server = hapi.server()

    await server.register(mongoDb)

    expect(connectDb).toHaveBeenCalledWith(undefined)
  })

  test('fails registration when the connection cannot be made', async () => {
    connectDb.mockRejectedValue(new Error('connect ECONNREFUSED'))
    const server = hapi.server()

    await expect(server.register(mongoDb)).rejects.toThrow('connect ECONNREFUSED')
  })
})
