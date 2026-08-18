import { randomBytes, createHash } from 'node:crypto'
import Joi from 'joi'
import { HttpError } from '@fetchkit/ffetch'
import { config } from '../config/index.js'
import { httpClient } from '../http/client.js'
import { createLogger } from '../logging/logger.js'

const logger = createLogger()

const baseUrl = config.get('crm.baseUrl')
const caseOriginCode = config.get('crm.caseOriginCode')
// Dataverse GUIDs are not necessarily RFC 4122 version 4, so no version
// constraint here — consistent with the caseId schema in api/schemas/outbound.js.
const guidSchema = Joi.string().guid().required()

// CRM error bodies are unbounded third party output. Cap what reaches the log
// so a single rejection cannot flood the ingestion pipeline.
const CRM_ERROR_BODY_MAX_LENGTH = 2000
const TRUNCATION_SUFFIX = '... (truncated)'

const HTTP_PRECONDITION_FAILED = 412

// Nibble positions and masks used to shape a hash digest into an RFC 4122
// version 4 GUID, as required by deriveMetadataRecordId.
const GUID_VERSION_NIBBLE_INDEX = 12
const GUID_VARIANT_NIBBLE_INDEX = 16
const GUID_VARIANT_MASK = 0x3
const GUID_VARIANT_RFC4122 = 0x8
const GUID_NIBBLE_COUNT = 32
const HEX_RADIX = 16

const baseHeaders = {
  'Content-Type': 'application/json',
  Prefer: 'return=representation'
}

// The metadata upsert never reads its response body, so return=representation
// is deliberately omitted: it would only make Dataverse serialise a payload
// that is immediately discarded.
const upsertHeaders = {
  'Content-Type': 'application/json',
  'If-None-Match': '*'
}

const attachCrmErrorBody = async (err) => {
  const response = err?.cause
  if (!response || typeof response.text !== 'function') {
    return
  }
  try {
    const body = await response.text()
    err.crmError = body.length > CRM_ERROR_BODY_MAX_LENGTH
      ? `${body.slice(0, CRM_ERROR_BODY_MAX_LENGTH - TRUNCATION_SUFFIX.length)}${TRUNCATION_SUFFIX}`
      : body
  } catch {
    // Body already consumed or unreadable — leave the original error untouched
  }
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

    const { schemeValue, subjectValue, teamRoutingValue, documentTypesId } = documentTypeMetadata

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
      caseorigincode: caseOriginCode,
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
          'rpa_SubmissionType_rpa_onlinesubmission@odata.bind': `/rpa_documenttypeses(${documentTypesId})`,
          rpa_onlinesubmission_rpa_activitymetadata: [activityMetadataItem]
        }
      ]
    }

    if (teamRoutingValue) {
      payload['ownerid@odata.bind'] = `/teams(${teamRoutingValue})`
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
    await attachCrmErrorBody(err)
    return {
      caseId: null,
      error: err
    }
  }
}

/**
 * Resolve the Dataverse primary key (activityid) of the online submission
 * activity attached to a case.
 *
 * rpa_onlinesubmissionid is a separate, non-key text attribute (set by this
 * service to a client-generated hex string at creation time) and must not be
 * used to address the entity — Dataverse's PrimaryIdAttribute for
 * rpa_onlinesubmission is activityid.
 */
const getOnlineSubmissionActivityId = async (authToken, caseId) => {
  try {
    const query = `/incidents(${caseId})?${buildQuery({
      $select: 'incidentid,title',
      $expand: 'incident_rpa_onlinesubmissions($select=activityid,rpa_onlinesubmissionid)'
    })}`
    const response = await httpClient(`${baseUrl}${query}`, {
      method: 'GET',
      headers: { Authorization: authToken, ...baseHeaders }
    })

    const data = await response.json()

    const activityId = data?.incident_rpa_onlinesubmissions?.[0]?.activityid || null

    return {
      onlineSubmissionActivityId: activityId,
      error: null
    }
  } catch (err) {
    await attachCrmErrorBody(err)
    return {
      onlineSubmissionActivityId: null,
      error: err
    }
  }
}

/**
 * Derives a stable GUID-formatted key from a (correlationId, fileId) pair so
 * that every attempt at writing a given file's metadata — including retries
 * within a single process and SQS redeliveries after a restart — addresses
 * the same Dataverse record. This makes the write safe to upsert instead of
 * always creating a new record.
 *
 * The key is a one-way digest rather than a random value. Both inputs are
 * themselves GUIDs, so the key carries no personal data and nothing
 * meaningful can be recovered from it where it appears in CRM telemetry.
 * Any future change to the inputs must preserve that property: a low entropy
 * input would be recoverable from the digest by brute force.
 *
 * @param {string} correlationId - GUID identifying the submission.
 * @param {string} fileId - GUID identifying the file within that submission.
 * @returns {string} A deterministic RFC 4122 version 4 formatted GUID.
 */
const deriveMetadataRecordId = (correlationId, fileId) => {
  const hash = createHash('sha256').update(`${correlationId}:${fileId}`).digest('hex')
  const hex = hash.slice(0, GUID_NIBBLE_COUNT).split('')
  hex[GUID_VERSION_NIBBLE_INDEX] = '4'
  hex[GUID_VARIANT_NIBBLE_INDEX] = (
    (parseInt(hex[GUID_VARIANT_NIBBLE_INDEX], HEX_RADIX) & GUID_VARIANT_MASK) | GUID_VARIANT_RFC4122
  ).toString(HEX_RADIX)
  const guid = hex.join('')
  return `${guid.slice(0, 8)}-${guid.slice(8, 12)}-${guid.slice(12, 16)}-${guid.slice(16, 20)}-${guid.slice(20, 32)}`
}

/**
 * Writes the metadata record as a conditional upsert.
 *
 * The record is addressed on its own entity set rather than the parent's
 * navigation property collection, which does not support PATCH. If-None-Match
 * makes the write create-only: Dataverse answers any subsequent attempt with
 * 412 rather than duplicating the record.
 *
 * Note that this is first-write-wins. A later write carrying the same derived
 * key but different content (a corrected name or mime type, say) is discarded
 * rather than applied, which is the intended behaviour for retries of a single
 * logical write.
 *
 * @returns {Promise<boolean>} true when the record was created, false when an
 * identical write had already created it.
 */
const upsertMetadataRecord = async (endpoint, authToken, payload) => {
  try {
    await httpClient(endpoint, {
      method: 'PATCH',
      headers: {
        Authorization: authToken,
        ...upsertHeaders
      },
      body: JSON.stringify(payload)
    })
    return true
  } catch (err) {
    if (err instanceof HttpError && err.cause?.status === HTTP_PRECONDITION_FAILED) {
      return false
    }
    throw err
  }
}

const createMetadataForOnlineSubmission = async (request) => {
  const { authToken, onlineSubmissionActivityId, metadata, correlationId, fileId } = request

  try {
    // Without both identifiers the derived key would be stable but meaningless,
    // and two files could collide onto one record — the second of which would
    // be answered with 412 and silently reported as a success.
    if (!correlationId || !fileId) {
      throw new Error(`Cannot derive a stable metadata key: correlationId and fileId are both required, got '${correlationId}' and '${fileId}'`)
    }

    // Derived before the write so every attempt at this file — including HTTP
    // client retries and SQS redeliveries — addresses the same record.
    const metadataId = deriveMetadataRecordId(correlationId, fileId)

    if (guidSchema.validate(onlineSubmissionActivityId).error) {
      throw new Error(`Invalid onlineSubmissionActivityId: expected a GUID, got '${onlineSubmissionActivityId}'`)
    }

    const { name, blobFileId, documentTypeId, mimeType } = metadata

    // The document type must be resolved before writing. There is deliberately
    // no default: a fallback would silently miscategorise the record in CRM,
    // so an unresolved document type is reported as an error instead.
    if (guidSchema.validate(documentTypeId).error) {
      throw new Error(`Invalid documentTypeId: expected a GUID, got '${documentTypeId}'`)
    }

    const payload = {
      rpa_name: name,
      rpa_blobfileid: blobFileId,
      'rpa_DocumentTypeMetaId@odata.bind': `/rpa_documenttypeses(${documentTypeId})`,
      'rpa_RelatedOnlineSubmissionId@odata.bind': `/rpa_onlinesubmissions(${onlineSubmissionActivityId})`
    }

    if (mimeType) {
      payload.rpa_filemimetype = mimeType
    }

    const endpoint = `${baseUrl}/rpa_activitymetadatas(${metadataId})`
    const created = await upsertMetadataRecord(endpoint, authToken, payload)

    if (!created) {
      // A prior attempt's write succeeded but its response was lost, delayed
      // or throttled. Logged so a rising count of suppressions stays visible.
      logger.info({ fileId, metadataId }, 'Metadata record already exists, duplicate write suppressed')
    }

    return {
      metadataId,
      error: null
    }
  } catch (err) {
    await attachCrmErrorBody(err)
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
  $select: '_rpa_scheme_value,_rpa_subject_value,_rpa_teamrouting_value,rpa_documenttypesid',
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
        teamRoutingValue: record._rpa_teamrouting_value,
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
  getOnlineSubmissionActivityId,
  getCaseIdByOnlineSubmissionId,
  createMetadataForOnlineSubmission,
  getDocumentTypeMetadata,
  deriveMetadataRecordId
}
