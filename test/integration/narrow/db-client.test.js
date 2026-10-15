import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import db, { connectDb, closeDb } from '../../../src/data/db.js'

describe('Create Mongo client', () => {
  beforeAll(async () => {
    await connectDb()
  })

  afterAll(async () => {
    await closeDb()
  })

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
