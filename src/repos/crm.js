import { config } from '../config/index.js'

const baseUrl = config.get('crm.baseUrl')

const baseHeaders = {
  'Content-Type': 'application/json',
  Prefer: 'return=representation'
}

const getContactIdFromCrn = async (authToken, crn) => {
  const query = `/contacts?%24select=contactid&%24filter=rpa_capcustomerid%20eq%20'${crn}'`

  try {
    const response = await fetch(`${baseUrl}${query}`, {
      method: 'GET',
      headers: { Authorization: authToken, ...baseHeaders }
    })
    const responseJson = await response.json()
    // Future: handle no results - get status code 200 whether it finds it or not
    return {
      contactId: responseJson.value[0]?.contactid
    }
  } catch (err) {
    return {
      contactId: null,
      error: err.message
    }
  }
}

// get business from SBI - we can also get FRN from here if needed
const getAccountIdFromSbi = async (authToken, sbi) => {
  const query = `/accounts?%24select=accountid&%24filter=rpa_sbinumber%20eq%20'${sbi}'`

  try {
    const response = await fetch(`${baseUrl}${query}`, {
      method: 'GET',
      headers: { Authorization: authToken, ...baseHeaders }
    })

    const responseJson = await response.json()
    // Future: handle no results - get status code 200 whether it finds it or not
    return {
      accountId: responseJson.value[0]?.accountid
    }
  } catch (err) {
    return {
      accountId: null,
      error: err.message
    }
  }
}

const createCase = async (authToken, contactId, accountId) => {
  try {
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
      headers: { Authorization: authToken, ...baseHeaders },
      body: JSON.stringify(payload)
    })

    const data = await response.json()
    const caseId = data.incidentid

    return {
      caseId,
      error: null
    }
  } catch (err) {
    return {
      caseId: null,
      error: err.message
    }
  }
}

const createOnlineSubmissionActivity = async (authToken, caseId, caseTitle, documentType, contactId, accountId) => {
  try {
    const payload = {
      'regardingobjectid_incident_rpa_onlinesubmission@odata.bind': `/incidents(${caseId})`,
      'rpa_SubmissionType_rpa_onlinesubmission@odata.bind': `/rpa_documentTypeses(${documentType})`,
      'rpa_filesinsubmission': 0,
      'rpa_onlinesubmission_activity_parties': [
        {
          participationtypemask: 1,
          'partyid_contact@odata.bind': `/contacts(${contactId})`
        },
        {
          participationtypemask: 11,
          'partyid_account@odata.bind': `/accounts(${accountId})`
        }
      ],
      rpa_onlinesubmissiondate: new Date(),
      rpa_onlinesubmissionid: 1234567890,
      rpa_genericcontrol1: 'BANKVERIFY,DEACTIVATE,FRAUD,PROBATE,INACTIVE',
      rpa_genericerror1: 'Invalid CRN(s)',
      rpa_genericcontrol2: '1234',
      subject: `${caseTitle}`
    }

    const response = await fetch(`${baseUrl}/rpa_onlinesubmissions`, {
      method: 'POST',
      headers: { Authorization: authToken, ...baseHeaders },
      body: JSON.stringify(payload)
    })

    const data = await response.json()
    const onlineSubmissionActivityId = data.activityid

    return {
      onlineSubmissionActivityId,
      error: null
    }
  } catch (err) {
    return {
      onlineSubmissionActivityId: null,
      error: err.message
    }
  }
}

// Future: get document type


export { 
  getContactIdFromCrn,
  getAccountIdFromSbi,
  createCase,
  createOnlineSubmissionActivity
}
