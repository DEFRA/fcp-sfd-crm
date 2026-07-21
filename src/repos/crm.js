import { randomBytes } from 'node:crypto'
import { config } from '../config/index.js'
import { httpClient } from '../http/client.js'

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
    const response = await httpClient(`${baseUrl}${query}`, {
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
      error: err
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
    const response = await httpClient(`${baseUrl}${query}`, {
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
      error: err
    }
  }
}

const createCaseWithOnlineSubmission = async (request) => {
  try {
    const { authToken, case: caseData, onlineSubmissionActivity } = request
    const { title, caseDescription, contactId, accountId, documentTypeMetadata } = caseData
    const { subject, description, scheduledStart, scheduledEnd, stateCode, statusCode, metadata } = onlineSubmissionActivity
    const { name, blobFileId, mimeType } = metadata

    const { schemeValue, subjectValue, documentTypesId } = documentTypeMetadata

    const activityMetadataItem = {
      rpa_name: name,
      rpa_blobfileid: blobFileId,
      'rpa_DocumentTypeMetaId@odata.bind': `/rpa_documenttypeses(${documentTypesId})`
    }

    if (mimeType) {
      activityMetadataItem.rpa_filemimetype = mimeType
    }

    const rpaOnlinesubmissionid = randomBytes(10).toString('hex')

    const payload = {
      title,
      description: caseDescription,
      caseorigincode: 100000002,
      prioritycode: 2,
      'customerid_contact@odata.bind': `/contacts(${contactId})`,
      'rpa_Contact@odata.bind': `/contacts(${contactId})`,
      'rpa_Organisation@odata.bind': `/accounts(${accountId})`,
      'rpa_Scheme@odata.bind': `/rpa_schemes(${schemeValue})`,
      'subjectid@odata.bind': `/subjects(${subjectValue})`,
      rpa_isunknowncontact: false,
      rpa_isunknownorganisation: false,
      incident_rpa_onlinesubmissions: [
        {
          subject,
          description,
          scheduledstart: scheduledStart,
          scheduledend: scheduledEnd,
          rpa_onlinesubmissiondate: new Date().toISOString(),
          rpa_onlinesubmissionid: rpaOnlinesubmissionid,
          statecode: stateCode,
          statuscode: statusCode,
          rpa_onlinesubmission_rpa_activitymetadata: [activityMetadataItem]
        }
      ]
    }

    const response = await httpClient(`${baseUrl}/incidents`, {
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
      rpaOnlinesubmissionid,
      error: null
    }
  } catch (err) {
    return {
      caseId: null,
      error: err
    }
  }
}

const getOnlineSubmissionId = async (authToken, caseId) => {
  try {
    const query = `/incidents(${caseId})?${buildQuery({
      $select: 'incidentid,title',
      $expand: 'incident_rpa_onlinesubmissions($select=rpa_onlinesubmissionid)'
    })}`
    const response = await httpClient(`${baseUrl}${query}`, {
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
      error: err
    }
  }
}

const createMetadataForOnlineSubmission = async (request) => {
  try {
    const { authToken, rpaOnlinesubmissionid, metadata } = request
    const { name, blobFileId, documentTypeId, mimeType } = metadata

    const payload = {
      rpa_name: name,
      rpa_blobfileid: blobFileId
    }

    if (mimeType) {
      payload.rpa_filemimetype = mimeType
    }

    if (documentTypeId) {
      payload['rpa_DocumentTypeMetaId@odata.bind'] = `/rpa_documenttypeses(${documentTypeId})`
    } else {
      payload['rpa_DocumentTypeMetaId@odata.bind'] = `/rpa_documenttypeses(${DEFAULT_DOCUMENT_TYPE_ID})`
    }

    const endpoint = `${baseUrl}/rpa_onlinesubmissions(${rpaOnlinesubmissionid})/rpa_onlinesubmission_rpa_activitymetadata`

    const response = await httpClient(endpoint, {
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
      error: err
    }
  }
}

const createMetadataForExistingCase = async (request) => {
  try {
    const { authToken, caseId, metadata } = request
    const { name, blobFileId, documentTypeId, contactId, accountId, mimeType } = metadata

    const payload = {
      rpa_name: name,
      rpa_blobfileid: blobFileId
    }

    if (mimeType) {
      payload.rpa_filemimetype = mimeType
    }

    if (documentTypeId) {
      payload['rpa_DocumentTypeMetaId@odata.bind'] = `/rpa_documenttypeses(${documentTypeId})`
    } else {
      payload['rpa_DocumentTypeMetaId@odata.bind'] = `/rpa_documenttypeses(${DEFAULT_DOCUMENT_TYPE_ID})`
    }

    if (contactId) {
      payload['rpa_Contact@odata.bind'] = `/contacts(${contactId})`
    }
    if (accountId) {
      payload['rpa_Organisation@odata.bind'] = `/accounts(${accountId})`
    }

    const endpoint = `${baseUrl}/incidents(${caseId})/incident_rpa_activitymetadata`

    const response = await httpClient(endpoint, {
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
      error: err
    }
  }
}

const CASE_TYPE_MAX_LENGTH = 200
const CONTROL_CHAR_UPPER_BOUND = 0x1f
const DELETE_CHAR_CODE = 0x7f

const hasControlChars = (str) => {
  for (let i = 0; i < str.length; i++) {
    const code = str.codePointAt(i)
    if (code <= CONTROL_CHAR_UPPER_BOUND || code === DELETE_CHAR_CODE) { return true }
  }
  return false
}

const getDocumentTypeMetadata = async (authToken, caseType) => {
  if (!caseType || typeof caseType !== 'string' || caseType.length > CASE_TYPE_MAX_LENGTH || hasControlChars(caseType)) {
    return {
      documentTypeMetadata: null,
      error: new Error(`Invalid caseType: must be a string of 1-${CASE_TYPE_MAX_LENGTH} characters with no control characters`)
    }
  }

  const escapedCaseType = caseType.replaceAll("'", "''")
  const query = `/rpa_documenttypeses?${buildQuery({
  $select: '_rpa_scheme_value,_rpa_subject_value,rpa_documenttypesid',
  $filter: `rpa_documenttype eq '${escapedCaseType}'`
})}`

  try {
    const response = await httpClient(`${baseUrl}${query}`, {
      method: 'GET',
      headers: { Authorization: authToken, ...baseHeaders }
    })

    const responseJson = await response.json()
    const record = responseJson.value[0]

    if (!record) {
      return { documentTypeMetadata: null, error: null }
    }

    return {
      documentTypeMetadata: {
        schemeValue: record._rpa_scheme_value,
        subjectValue: record._rpa_subject_value,
        documentTypesId: record.rpa_documenttypesid
      },
      error: null
    }
  } catch (err) {
    return { documentTypeMetadata: null, error: err }
  }
}

const getCaseIdByOnlineSubmissionId = async (authToken, rpaOnlinesubmissionid) => {
  try {
    const query = `/rpa_onlinesubmissions?${buildQuery({
      $select: '_regardingobjectid_value',
      $filter: `rpa_onlinesubmissionid eq '${rpaOnlinesubmissionid}'`
    })}`

    const response = await httpClient(`${baseUrl}${query}`, {
      method: 'GET',
      headers: { Authorization: authToken, ...baseHeaders }
    })

    const data = await response.json()
    const caseId = data?.value?.[0]?._regardingobjectid_value || null

    return { caseId, error: null }
  } catch (err) {
    return { caseId: null, error: err }
  }
}

export {
  getContactIdFromCrn,
  getAccountIdFromSbi,
  createCaseWithOnlineSubmission,
  getOnlineSubmissionId,
  getCaseIdByOnlineSubmissionId,
  createMetadataForOnlineSubmission,
  createMetadataForExistingCase,
  getDocumentTypeMetadata
}
