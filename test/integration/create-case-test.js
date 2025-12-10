// this file can be used to test the functionality of the repos/crm operations
// rename this file to include '.test.js' so the test runner pick it up
// When ran this will create a case in the DEV CRM instance and can also be used to verify functionality of contact and account functions.

import { describe, test, expect } from 'vitest'
import { getCrmAuthToken } from '../../src/auth/get-crm-auth-token'
import { getContactIdFromCrn, getAccountIdFromSbi, createCase } from '../../src/repos/crm'

describe('Create case in CRM', () => {
  const validCrn = 2624714378
  const validSbi = 155363499
  describe('GET contactId from crn', () => {
    test('should return the contactId when crn exists in CRM', async () => {
      const authToken = await getCrmAuthToken()
      const { contactId } = await getContactIdFromCrn(authToken, validCrn)
      expect(contactId).toBeDefined()
      expect(contactId).toBe('8bb8b45b-aba2-f011-bbd2-7ced8d4645a2')
    })
  })

  describe('GET accountId from sbi', () => {
    test('should return the accountId when sbi exists in CRM', async () => {
      const authToken = await getCrmAuthToken()
      const { accountId } = await getAccountIdFromSbi(authToken, validSbi)
      expect(accountId).toBeDefined()
      expect(accountId).toBe('4ab7b45b-aba2-f011-bbd2-7ced8d4645a2')
    })
  })

  describe('POST Create case in CRM', () => {
    test('should return the caseId when a case is successfully created.', async () => {
      const authToken = await getCrmAuthToken()
      const validContactId = '8bb8b45b-aba2-f011-bbd2-7ced8d4645a2'
      const validAccountId = '4ab7b45b-aba2-f011-bbd2-7ced8d4645a2'

      const { caseId } = await createCase(authToken, validContactId, validAccountId)

      expect(caseId).toBeDefined()
      expect(caseId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    }, 60000)
  })
})
