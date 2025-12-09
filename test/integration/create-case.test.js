import { describe, test, expect } from 'vitest'
import { getCrmAuthToken } from '../../src/auth/get-crm-auth-token'
import { getContactIdFromCrn, getAccountIdFromSbi } from '../../src/repos/crm'

describe('Create case in CRM', () => {
    describe('GET contactId from crn', () => {
        const validCrn = 2624714378

        test('should return the contactId when crn exists in CRM', async () => {
            const authToken = await getCrmAuthToken()
            const { contactId } = await getContactIdFromCrn(authToken, validCrn)
            expect(contactId).toBeDefined()
            expect(contactId).toBe('8bb8b45b-aba2-f011-bbd2-7ced8d4645a2')
        })
    })

    describe('GET accountId from sbi', () => {
        const validSbi = 155363499

        test('should return the accountId when sbi exists in CRM', async () => {
            const authToken = await getCrmAuthToken()
            const { accountId } = await getAccountIdFromSbi(authToken, validSbi)
            expect(accountId).toBeDefined()
            expect(accountId).toBe('4ab7b45b-aba2-f011-bbd2-7ced8d4645a2')
        })
    })
})
