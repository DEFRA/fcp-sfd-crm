import { config } from '../config/index.js'
// inputs CRN, SBI, CRM Queue, some metadata

const baseUrl = config.get('crm.baseUrl')

// get contact from CRN
const getContactIdFromCrn = async (authToken, crn) => {
    const query = `/contacts?%24select=contactid&%24filter=rpa_capcustomerid%20eq%20'${crn}'`

    const response = await fetch(`${baseUrl}${query}`, {
        method: 'GET',
        headers: { Authorization: authToken }
    })
    const responseJson = await response.json()
    // Future: handle no results - get status code 200 whether it finds it or not
    return {
        contactId: responseJson.value[0].contactid
    }
}

// get business from SBI - we can also get FRN from here if needed
const getAccountIdFromSbi = async (authToken, sbi) => {
    const query = `/accounts?%24select=accountid&%24filter=rpa_sbinumber%20eq%20'${sbi}'`

    const response = await fetch(`${baseUrl}${query}`, {
        method: 'GET',
        headers: { Authorization: authToken }
    })

    const responseJson = await response.json()
    // Future: handle no results - get status code 200 whether it finds it or not
    return {
        accountId: responseJson.value[0].accountid
    }
}

// get document type - what is this?
// create case
// create online submission (params dictate type)

export { getContactIdFromCrn, getAccountIdFromSbi }
