import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { setToken, getToken } from '../../../../src/repos/token.js'
import db from '../../../../src/data/db.js'
import { config } from '../../../../src/config/index.js'

describe('Token repository - Database integration', () => {
  const tokenId = config.get('auth.tokenId')
  const testTokenValue = 'Bearer test-integration-token-12345'
  const expiresInSeconds = 3600

  // Clean up test data before and after tests
  beforeEach(async () => {
    await db.collection('tokens').deleteOne({ _id: tokenId })
  })

  afterEach(async () => {
    await db.collection('tokens').deleteOne({ _id: tokenId })
  })

  describe('setToken', () => {
    test('should insert a new token into the database', async () => {
      await setToken(testTokenValue, expiresInSeconds)

      const storedToken = await db.collection('tokens').findOne({ _id: tokenId })

      expect(storedToken).toBeDefined()
      expect(storedToken.value).toBe(testTokenValue)
      expect(storedToken.expiresAt).toBeGreaterThan(Date.now())
      expect(storedToken.updatedAt).toBeInstanceOf(Date)
    })

    test('should update existing token when called again (upsert)', async () => {
      // Insert initial token
      await setToken('Bearer initial-token', 1800)

      // Update with new token
      const newTokenValue = 'Bearer updated-token'
      await setToken(newTokenValue, expiresInSeconds)

      const tokens = await db.collection('tokens').find({ _id: tokenId }).toArray()

      // Should only have one token (updated, not duplicated)
      expect(tokens).toHaveLength(1)
      expect(tokens[0].value).toBe(newTokenValue)
    })

    test('should calculate correct expiry time in milliseconds', async () => {
      const beforeCall = Date.now()
      await setToken(testTokenValue, 7200) // 2 hours
      const afterCall = Date.now()

      const storedToken = await db.collection('tokens').findOne({ _id: tokenId })
      const expectedMin = beforeCall + (7200 * 1000)
      const expectedMax = afterCall + (7200 * 1000)

      expect(storedToken.expiresAt).toBeGreaterThanOrEqual(expectedMin)
      expect(storedToken.expiresAt).toBeLessThanOrEqual(expectedMax)
    })
  })

  describe('getToken', () => {
    test('should return null when token does not exist in database', async () => {
      const token = await getToken()

      expect(token).toBeNull()
    })

    test('should return token value when token exists and is valid', async () => {
      // Insert valid token directly into database
      await db.collection('tokens').insertOne({
        _id: tokenId,
        value: testTokenValue,
        expiresAt: Date.now() + (3600 * 1000), // expires in 1 hour
        updatedAt: new Date()
      })

      const token = await getToken()

      expect(token).toBe(testTokenValue)
    })

    test('should return null when token is expired', async () => {
      // Insert expired token directly into database
      await db.collection('tokens').insertOne({
        _id: tokenId,
        value: testTokenValue,
        expiresAt: Date.now() - 1000, // expired 1 second ago
        updatedAt: new Date()
      })

      const token = await getToken()

      expect(token).toBeNull()
    })

    test('should return null when token expires exactly now', async () => {
      // Insert token that expires at current time
      await db.collection('tokens').insertOne({
        _id: tokenId,
        value: testTokenValue,
        expiresAt: Date.now(),
        updatedAt: new Date()
      })

      const token = await getToken()

      expect(token).toBeNull()
    })
  })

  describe('setToken and getToken integration', () => {
    test('should store and retrieve the same token', async () => {
      await setToken(testTokenValue, expiresInSeconds)

      const retrievedToken = await getToken()

      expect(retrievedToken).toBe(testTokenValue)
    })

    test('should handle multiple set and get operations', async () => {
      // First token
      await setToken('Bearer token-1', 3600)
      expect(await getToken()).toBe('Bearer token-1')

      // Update token
      await setToken('Bearer token-2', 3600)
      expect(await getToken()).toBe('Bearer token-2')

      // Update again
      await setToken('Bearer token-3', 3600)
      expect(await getToken()).toBe('Bearer token-3')
    })
  })
})
