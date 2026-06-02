import { describe, test, expect } from 'vitest'

let db
let skipIntegration = false
try {
  // attempt to import DB; if Mongo is not available this will throw
  const mod = await import('../../../src/data/db.js')
  db = mod.default
} catch (err) {
  // mark to skip integration tests that require MongoDB

  console.warn('Skipping integration DB tests; MongoDB not available:', err.message)
  skipIntegration = true
}

const testOrSkip = skipIntegration ? describe.skip : describe

testOrSkip('Create Mongo client', () => {
  test('should return an instance of database client', async () => {
    expect(db).toBeDefined()
    expect(db.s.namespace.db).toBe('fcp-sfd-crm')
    expect(db.databaseName).toBe('fcp-sfd-crm')
  })

  test('should have a connected MongoDB client', async () => {
    expect(db.client).toBeDefined()
    expect(db.client.topology.isConnected()).toBe(true)
  })

  test('db client should be able to upload data to collection', async () => {
    const uploadResult = await db.collection('test').insertOne({ test: 'test' })
    expect(uploadResult.acknowledged).toBe(true)
  })

  test('db client should be able to retrieve from collection', async () => {
    const queryResult = await db.collection('test').findOne({ test: 'test' })
    expect(queryResult.test).toBe('test')
  })
})
