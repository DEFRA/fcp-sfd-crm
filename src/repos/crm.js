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

// create case

const createCase = async (authToken, crn, sbi) => {
    try {
        const { accountId } = await getAccountIdFromSbi(sbi)
        const { contactId } = await getContactIdFromCrn(crn)

        const payload = {
            caseorigincode: 100000002,
            casetypecode: 927350013,
            'customerid_contact@odata.bind': `/contacts(${contactId})`,
            'rpa_Contact@odata.bind': `/contacts(${contactId})`,
            'rpa_Organisation@odata.bind': `/accounts(${accountId})`,
            rpa_isunknowncontact: false,
            rpa_isunknownorganisation: false,
            title: 'fcp-sfd-crm test case'
        }

        const response = await fetch(`${baseUrl}/incidents`, {
            method: 'POST',
            headers: { Authorization: authToken, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        })

        console.log(response.headers.get('location'), '*******')
    } catch (err) {
        console.error(err)
    }
    return {
        caseId: 'test'
    }
}

// get document type - what is this?
// create online submission (params dictate type)

export { getContactIdFromCrn, getAccountIdFromSbi, createCase }
