import { config } from '../config/index.js'
import db from '../data/db.js'

const setToken = async (tokenValue, expiresInSeconds) => {
  const expiresAt = Date.now() + (expiresInSeconds * 1000)

  await db.collection('tokens').updateOne(
    { _id: config.get('auth.tokenId') },
    {
      $set: {
        value: tokenValue,
        expiresAt,
        updatedAt: new Date()
      }
    },
    { upsert: true }
  )
}

const getToken = async () => {
  const token = await db.collection('tokens').findOne({ _id: config.get('auth.tokenId') })

  if (!token) {
    return null
  }

  // Check if token is still valid
  if (Date.now() >= token.expiresAt) {
    return null // Expired
  }

  return token.value
}

export {
  setToken,
  getToken
}
