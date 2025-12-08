import { config } from '../config/index.js';
import db from '../data/db.js'

// set token value and expiry
// generateCrmAuthToken returns token and expiresIn
const setToken = async (tokenValue, expiresInMs) => {
  const expiresAt = Date.now() + (expiresInSeconds * 1000);
  
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
  );
};


const getToken = async () => {
  const token = await db.collection('tokens').findOne({ _id: config.get('auth.tokenId') });
  
  if (!token) {
    return null;
  }
  
  // Check if token is still valid
  if (Date.now() >= token.expiresAt) {
    return null; // Expired
  }
  
  return token.value;
};


// get token from database