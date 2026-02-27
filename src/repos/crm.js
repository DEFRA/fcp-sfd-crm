import { config } from '../config/index.js'

const baseUrl = config.get('crm.baseUrl')
const DEFAULT_DOCUMENT_TYPE_ID = '4e88916b-aae2-ee11-904c-000d3adc1ec9'

const baseHeaders = {
  'Content-Type': 'application/json',
  Prefer: 'return=representation'
}

const buildQuery = (params) =>
  Object.entries(params)
    .map(([k, v]) => {
      const encodedKey = encodeURIComponent(k)
      const encodedValue = encodeURIComponent(v)
        .replaceAll('%2C', ',')
        .replaceAll('%3D', '=')
      return `${encodedKey}=${encodedValue}`
    })
    .join('&')

const getContactIdFromCrn = async (authToken, crn) => {
  const query = `/contacts?${buildQuery({
    $select: 'contactid',
    $filter: `rpa_capcustomerid eq '${crn}'`
  })}`

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
  const query = `/accounts?${buildQuery({
    $select: 'accountid',
    $filter: `rpa_sbinumber eq '${sbi}'`
  })}`

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

const createCaseWithOnlineSubmission = async (request) => {
  try {
    const { authToken, case: caseData, onlineSubmissionActivity } = request
    const { title, caseDescription, contactId, accountId } = caseData
    const { subject, description, scheduledStart, scheduledEnd, stateCode, statusCode, metadata } = onlineSubmissionActivity
    const { name, fileUrl } = metadata

    const payload = {
      title,
      description: caseDescription,
      caseorigincode: 100000002,
      prioritycode: 2,
      'customerid_contact@odata.bind': `/contacts(${contactId})`,
      'rpa_Contact@odata.bind': `/contacts(${contactId})`,
      'rpa_Organisation@odata.bind': `/accounts(${accountId})`,
      rpa_isunknowncontact: false,
      rpa_isunknownorganisation: false,
      incident_rpa_onlinesubmissions: [
        {
          subject,
          description,
          scheduledstart: scheduledStart,
          scheduledend: scheduledEnd,
          rpa_onlinesubmissionid: 'OLS-2026-0001',
          rpa_onlinesubmissiondate: new Date().toISOString(),
          statecode: stateCode,
          statuscode: statusCode,
          rpa_onlinesubmission_rpa_activitymetadata: [
            {
              rpa_name: name,
              rpa_fileabsoluteurl: fileUrl,
              rpa_copiedfileurl: fileUrl,
              'rpa_DocumentTypeMetaId@odata.bind': `/rpa_documenttypeses(${DEFAULT_DOCUMENT_TYPE_ID})`
            }
          ]
        }
      ]
    }

    const response = await fetch(`${baseUrl}/incidents`, {
      method: 'POST',
      headers: {
        Authorization: authToken,
        ...baseHeaders
      },
      body: JSON.stringify(payload)
    })

    const data = await response.json()

    return {
      caseId: data.incidentid,
      error: null
    }
  } catch (err) {
    return {
      caseId: null,
      error: err.message
    }
  }
}

const getOnlineSubmissionId = async (authToken, caseId) => {
  try {
    const query = `/incidents(${caseId})?${buildQuery({
      $select: 'incidentid,title',
      $expand: 'incident_rpa_onlinesubmissions($select=rpa_onlinesubmissionid)'
    })}`
    const response = await fetch(`${baseUrl}${query}`, {
      method: 'GET',
      headers: { Authorization: authToken, ...baseHeaders }
    })

    const data = await response.json()

    const rpaId = data?.incident_rpa_onlinesubmissions?.[0]?.rpa_onlinesubmissionid || null

    return {
      rpaOnlinesubmissionid: rpaId,
      error: null
    }
  } catch (err) {
    return {
      rpaOnlinesubmissionid: null,
      error: err.message
    }
  }
}

const createMetadataForOnlineSubmission = async (request) => {
  try {
    const { authToken, rpaOnlinesubmissionid, metadata } = request
    const { name, fileUrl, documentTypeId } = metadata

    const payload = {
      rpa_name: name,
      rpa_fileabsoluteurl: fileUrl,
      rpa_copiedfileurl: fileUrl
    }

    if (documentTypeId) {
      payload['rpa_DocumentTypeMetaId@odata.bind'] = `/rpa_documenttypeses(${documentTypeId})`
    } else {
      payload['rpa_DocumentTypeMetaId@odata.bind'] = `/rpa_documenttypeses(${DEFAULT_DOCUMENT_TYPE_ID})`
    }

    const endpoint = `${baseUrl}/rpa_onlinesubmissions(${rpaOnlinesubmissionid})/rpa_onlinesubmission_rpa_activitymetadata`

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: authToken,
        ...baseHeaders
      },
      body: JSON.stringify(payload)
    })

    const data = await response.json()

    return {
      metadataId: data?.rpa_activitymetadataid || null,
      error: null
    }
  } catch (err) {
    return {
      metadataId: null,
      error: err.message
    }
  }
}

const createMetadataForExistingCase = async (request) => {
  try {
    const { authToken, caseId, metadata } = request
    const { name, fileUrl, documentTypeId, contactId, accountId } = metadata

    const payload = {
      rpa_name: name,
      rpa_fileabsoluteurl: fileUrl,
      rpa_copiedfileurl: fileUrl
    }

    if (documentTypeId) {
      payload['rpa_DocumentTypeMetaId@odata.bind'] = `/rpa_documenttypeses(${documentTypeId})`
    } else {
      payload['rpa_DocumentTypeMetaId@odata.bind'] = '/rpa_documenttypeses(4e88916b-aae2-ee11-904c-000d3adc1ec9)'
    }

    if (contactId) {
      payload['rpa_Contact@odata.bind'] = `/contacts(${contactId})`
    }
    if (accountId) {
      payload['rpa_Organisation@odata.bind'] = `/accounts(${accountId})`
    }

    const endpoint = `${baseUrl}/incidents(${caseId})/incident_rpa_activitymetadata`

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: authToken,
        ...baseHeaders
      },
      body: JSON.stringify(payload)
    })

    const data = await response.json()

    return {
      metadataId: data?.rpa_activitymetadataid || null,
      error: null
    }
  } catch (err) {
    return {
      metadataId: null,
      error: err.message
    }
  }
}

// Future: get document type
export {
  getContactIdFromCrn,
  getAccountIdFromSbi,
  createCaseWithOnlineSubmission,
  getOnlineSubmissionId,
  createMetadataForOnlineSubmission
  ,
  createMetadataForExistingCase
}
