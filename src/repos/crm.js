import { randomBytes, createHash } from 'node:crypto'
import Joi from 'joi'
import { HttpError } from '@fetchkit/ffetch'
import { config } from '../config/index.js'
import { httpClient, triageHttpClient } from '../http/client.js'
import { createLogger } from '../logging/logger.js'
import { toTenantMessage } from '../logging/tenant-message.js'
import { buildChangesetRequest, parseBatchResponse } from './dataverse-batch.js'
import { triageFailureReasons } from '../constants/integration-inbound-triage.js'

const logger = createLogger()

const getBaseUrl = () => config.get('crm.baseUrl')
const getCaseOriginCode = () => config.get('crm.caseOriginCode')
// Dataverse GUIDs are not necessarily RFC 4122 version 4, so no version
// constraint here — consistent with the caseId schema in api/schemas/outbound.js.
const guidSchema = Joi.string().guid().required()

// CRM error bodies are unbounded third party output. Cap what reaches the log
// so a single rejection cannot flood the ingestion pipeline.
const CRM_ERROR_BODY_MAX_LENGTH = 2000
const TRUNCATION_SUFFIX = '... (truncated)'

const HTTP_PRECONDITION_FAILED = 412
// A successful conditional upsert with no Prefer: return=representation
// answers 204. Anything else on a $batch part — including a 2xx that is not
// 204 — is treated as unexpected rather than assumed benign.
const HTTP_NO_CONTENT = 204

// Nibble positions and masks used to shape a hash digest into an RFC 4122
// version 4 GUID, as required by deriveMetadataRecordId.
const GUID_VERSION_NIBBLE_INDEX = 12
const GUID_VARIANT_NIBBLE_INDEX = 16
const GUID_VARIANT_MASK = 0x3
const GUID_VARIANT_RFC4122 = 0x8
const GUID_NIBBLE_COUNT = 32
const HEX_RADIX = 16

// RFC 4122 GUID segment lengths (in hex characters). Format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
const GUID_TIME_LOW_LENGTH = 8
const GUID_TIME_MID_LENGTH = 4
const GUID_TIME_HI_VERSION_LENGTH = 4
const GUID_CLOCK_SEQ_LENGTH = 4
const GUID_NODE_LENGTH = 12

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
  const baseUrl = getBaseUrl()
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
  const baseUrl = getBaseUrl()
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
  const baseUrl = getBaseUrl()
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
 * Shapes a sha256 digest of the given parts into an RFC 4122 version 4
 * formatted GUID. Private: callers derive a record id through one of the
 * named wrappers below, each of which fixes the parts that make up its
 * digest so identically-shaped ids for different record types cannot
 * collide with one another.
 *
 * The key is a one-way digest rather than a random value, which is what
 * makes it safe to use as a client-supplied primary key: every attempt at
 * writing a given record — including retries within a single process and
 * SQS redeliveries after a restart — addresses the same Dataverse record,
 * which makes the write safe to upsert instead of always creating a new one.
 *
 * @param {...string} parts - joined with ':' before hashing.
 * @returns {string} A deterministic RFC 4122 version 4 formatted GUID.
 */
const deriveRecordId = (...parts) => {
  const hash = createHash('sha256').update(parts.join(':')).digest('hex')
  const hex = hash.slice(0, GUID_NIBBLE_COUNT).split('')
  hex[GUID_VERSION_NIBBLE_INDEX] = '4'
  hex[GUID_VARIANT_NIBBLE_INDEX] = (
    (Number.parseInt(hex[GUID_VARIANT_NIBBLE_INDEX], HEX_RADIX) & GUID_VARIANT_MASK) | GUID_VARIANT_RFC4122
  ).toString(HEX_RADIX)
  const guid = hex.join('')

  const timeLowEnd = GUID_TIME_LOW_LENGTH
  const timeMidEnd = timeLowEnd + GUID_TIME_MID_LENGTH
  const timeHiVersionEnd = timeMidEnd + GUID_TIME_HI_VERSION_LENGTH
  const clockSeqEnd = timeHiVersionEnd + GUID_CLOCK_SEQ_LENGTH
  const nodeEnd = clockSeqEnd + GUID_NODE_LENGTH

  return `${guid.slice(0, timeLowEnd)}-${guid.slice(timeLowEnd, timeMidEnd)}-${guid.slice(timeMidEnd, timeHiVersionEnd)}-${guid.slice(timeHiVersionEnd, clockSeqEnd)}-${guid.slice(clockSeqEnd, nodeEnd)}`
}

/**
 * Derives a stable GUID-formatted key from a (correlationId, fileId) pair so
 * that every attempt at writing a given file's metadata addresses the same
 * Dataverse record.
 *
 * Both inputs are themselves GUIDs, so the key carries no personal data and
 * nothing meaningful can be recovered from it where it appears in CRM
 * telemetry. Any future change to the inputs must preserve that property: a
 * low entropy input would be recoverable from the digest by brute force.
 *
 * Unnamespaced, for backwards compatibility with records already written
 * under this exact derivation in both Dataverse organisations. Do not change
 * its input shape — see the pinned regression test in crm.test.js.
 *
 * @param {string} correlationId - GUID identifying the submission.
 * @param {string} fileId - GUID identifying the file within that submission.
 * @returns {string} A deterministic RFC 4122 version 4 formatted GUID.
 */
const deriveMetadataRecordId = (correlationId, fileId) => deriveRecordId(correlationId, fileId)

/**
 * Derives a stable GUID-formatted key for the case (incident) created by a
 * submission. Keyed on correlationId alone, deliberately: a submission has
 * exactly one case, so every file in it — including one taking over case
 * creation from a failed creator — must derive the same identifier. Namespaced
 * against deriveOnlineSubmissionRecordId so the two never collide for the
 * same correlationId.
 *
 * @param {string} correlationId - GUID identifying the submission.
 * @returns {string} A deterministic RFC 4122 version 4 formatted GUID.
 */
const deriveCaseRecordId = (correlationId) => deriveRecordId('incident', correlationId)

/**
 * Derives a stable GUID-formatted key for a submission's online submission
 * (rpa_onlinesubmission) activity record. Keyed on correlationId alone, for
 * the same reason as deriveCaseRecordId. Namespaced against it so the two
 * never collide for the same correlationId.
 *
 * @param {string} correlationId - GUID identifying the submission.
 * @returns {string} A deterministic RFC 4122 version 4 formatted GUID.
 */
const deriveOnlineSubmissionRecordId = (correlationId) => deriveRecordId('onlinesubmission', correlationId)
/**
 * Derives a stable GUID-formatted key for a triage record in
 * rpa_integrationinboundqueue. Keyed on correlationId + fileId +
 * failureReason: this keeps retries of the same failure idempotent while still
 * allowing different files, and different terminal reasons for the same file,
 * to be recorded separately.
 *
 * @param {string} correlationId - GUID identifying the submission.
 * @param {string} fileId - GUID identifying the file within that submission.
 * @param {string} failureReason - Canonical triage classification reason.
 * @returns {string} A deterministic RFC 4122 version 4 formatted GUID.
 */
const deriveIntegrationInboundQueueRecordId = (correlationId, fileId, failureReason) => deriveRecordId('integrationinboundqueue', correlationId, fileId, failureReason)

/**
 * Writes a record as a conditional upsert, addressed by a derived key on its
 * own entity set rather than as a nested navigation property, which does not
 * support PATCH. If-None-Match makes the write create-only: Dataverse
 * answers any subsequent attempt with 412 rather than duplicating the
 * record. Used for the metadata record and, since the case-duplication fix,
 * for the incident and online submission records too.
 *
 * Note that this is first-write-wins. A later write carrying the same derived
 * key but different content (a corrected name or mime type, say) is discarded
 * rather than applied, which is the intended behaviour for retries of a single
 * logical write.
 *
 * @returns {Promise<boolean>} true when the record was created, false when an
 * identical write had already created it.
 */
const upsertRecord = async (endpoint, authToken, payload, client = httpClient) => {
  try {
    await client(endpoint, {
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

    const baseUrl = getBaseUrl()
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
    const created = await upsertRecord(endpoint, authToken, payload)

    if (!created) {
      // A prior attempt's write succeeded but its response was lost, delayed
      // or throttled. Logged so a rising count of suppressions stays visible.
      // event.reference carries metadataId, a one-way digest safe to index,
      // so a reader can query Dataverse for this exact record directly.
      logger.info({
        event: { reference: metadataId },
        tenant: { message: toTenantMessage({ fileId }) }
      }, 'Metadata record already exists, duplicate write suppressed')
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

const TRIAGE_RECORD_NAME_PREFIX = 'SFD doc upload failure'
const TRIAGE_RECORD_NAME_MAX_LENGTH = 100
const TRIAGE_PROCESSING_RESULT_FAILED = 927350001

const buildTriageRecordName = (correlationId) => (
  `${TRIAGE_RECORD_NAME_PREFIX} ${correlationId}`.slice(0, TRIAGE_RECORD_NAME_MAX_LENGTH)
)

const createIntegrationInboundQueueRecord = async (request) => {
  const { authToken, correlationId, fileId, failureReason, errorDetails, processingEntity } = request

  try {
    if (!correlationId || !fileId || !failureReason) {
      throw new Error(`Cannot derive triage key: correlationId, fileId and failureReason are required, got '${correlationId}', '${fileId}' and '${failureReason}'`)
    }

    if (!errorDetails) {
      throw new Error('Missing required triage errorDetails payload')
    }

    const triageRecordId = deriveIntegrationInboundQueueRecordId(correlationId, fileId, failureReason)
    const baseUrl = getBaseUrl()

    const payload = {
      rpa_name: buildTriageRecordName(correlationId),
      rpa_errordetails: errorDetails,
      rpa_processingresult: TRIAGE_PROCESSING_RESULT_FAILED
    }

    if (processingEntity !== null && processingEntity !== undefined) {
      if (!Number.isSafeInteger(processingEntity)) {
        throw new TypeError(`Invalid processing entity value: '${processingEntity}'`)
      }
      payload.rpa_processingentity = processingEntity
    }

    const endpoint = `${baseUrl}/rpa_integrationinboundqueues(${triageRecordId})`
    const created = await upsertRecord(endpoint, authToken, payload, triageHttpClient)

    return {
      triageRecordId,
      created,
      error: null
    }
  } catch (err) {
    await attachCrmErrorBody(err)
    return {
      triageRecordId: null,
      created: false,
      error: err
    }
  }
}

/**
 * Logs that a case creation changeset was suppressed because the derived
 * records already existed — the redelivery-after-timeout case this whole
 * mechanism exists for. Mirrors the metadata suppression log in level and
 * intent. This is the single most valuable line the fix produces: it turns
 * a silent duplicate into an observable, countable event.
 */
const logCaseCreationSuppressed = ({ caseId, correlationId, fileId }) => {
  logger.info({
    event: {
      type: 'crm.case.create_suppressed',
      action: 'create_case',
      category: 'crm',
      outcome: 'success',
      reason: 'case_already_exists',
      reference: caseId
    },
    tenant: { message: toTenantMessage({ correlationId, fileId }) }
  }, 'Case already exists, duplicate creation suppressed')
}

/**
 * Builds the derived record ids and the three PATCH parts for the case
 * creation changeset, from the same inputs the old deep-insert payload used.
 * Pure and synchronous: makes no request.
 *
 * @throws {Error} when documentTypeMetadata is incomplete. Team routing is
 * required alongside the rest: a case or activity left unowned reaches no
 * team's queue, so it is never written at all rather than written unroutable.
 */
const buildCaseChangeset = ({ correlationId, fileId, caseData, onlineSubmissionActivity, filesInBatch }) => {
  const baseUrl = getBaseUrl()
  const caseOriginCode = getCaseOriginCode()
  const { title, caseDescription, contactId, accountId, documentTypeMetadata } = caseData
  const { subject, description, scheduledStart, scheduledEnd, stateCode, statusCode, metadata } = onlineSubmissionActivity
  const { name, blobFileId, mimeType } = metadata
  const { schemeValue, subjectValue, teamRoutingValue, documentTypesId } = documentTypeMetadata
  const shouldWriteFilesInSubmission = config.get('crm.writeFilesInSubmission') && Number.isInteger(filesInBatch) && filesInBatch > 0

  // Every one of these is bound into the payload below, so a missing value
  // would be interpolated as the string 'undefined' and rejected by Dataverse
  // as a malformed bind, or worse, silently produce an unroutable case that
  // no team ever works. There is deliberately no fallback for any of them:
  // defaulting would hide the misconfiguration rather than surface it.
  const missing = Object.entries({ schemeValue, subjectValue, teamRoutingValue, documentTypesId })
    .filter(([, value]) => !value)
    .map(([key]) => key)
  if (missing.length) {
    const err = new Error(`Incomplete documentTypeMetadata: ${missing.join(', ')} required`)
    err.triageFailureReason = triageFailureReasons.DOCUMENT_TYPE_METADATA_INCOMPLETE
    throw err
  }

  const caseId = deriveCaseRecordId(correlationId)
  const onlineSubmissionId = deriveOnlineSubmissionRecordId(correlationId)
  const metadataId = deriveMetadataRecordId(correlationId, fileId)

  // Left random rather than derived from correlationId. Unlike caseId,
  // onlineSubmissionId and metadataId above, rpa_onlinesubmissionid is not a
  // primary key (Dataverse primary keys are always type uniqueidentifier,
  // with no length constraint) — it is an ordinary string attribute, and its
  // configured MaxLength is 20, too short to hold a 36-character correlationId.
  const rpaOnlinesubmissionid = randomBytes(10).toString('hex')

  const casePayload = {
    title,
    description: caseDescription,
    caseorigincode: caseOriginCode,
    prioritycode: 2,
    'customerid_contact@odata.bind': `/contacts(${contactId})`,
    'rpa_Contact@odata.bind': `/contacts(${contactId})`,
    'rpa_Organisation@odata.bind': `/accounts(${accountId})`,
    'rpa_Scheme@odata.bind': `/rpa_schemes(${schemeValue})`,
    'subjectid@odata.bind': `/subjects(${subjectValue})`,
    'ownerid@odata.bind': `/teams(${teamRoutingValue})`,
    rpa_isunknowncontact: false,
    rpa_isunknownorganisation: false
  }

  const onlineSubmissionPayload = {
    subject,
    description,
    scheduledstart: scheduledStart,
    scheduledend: scheduledEnd,
    rpa_onlinesubmissiondate: new Date().toISOString(),
    rpa_onlinesubmissionid: rpaOnlinesubmissionid,
    statecode: stateCode,
    statuscode: statusCode,
    'rpa_SubmissionType_rpa_onlinesubmission@odata.bind': `/rpa_documenttypeses(${documentTypesId})`,
    // Set on the activity in its own right, not inherited from the case:
    // Dataverse assigns a newly created activity to the calling user, so
    // without this bind the activity stays owned by the integration's service
    // principal even when the parent case is routed correctly.
    'ownerid@odata.bind': `/teams(${teamRoutingValue})`,
    // Read directly from RelationshipDefinitions rather than guessed.
    // Do not shorten or re-derive this name.
    'regardingobjectid_incident_rpa_onlinesubmission@odata.bind': `/incidents(${caseId})`
  }

  if (shouldWriteFilesInSubmission) {
    onlineSubmissionPayload.rpa_filesinsubmission = filesInBatch
  }

  const metadataPayload = {
    rpa_name: name,
    rpa_blobfileid: blobFileId,
    'rpa_DocumentTypeMetaId@odata.bind': `/rpa_documenttypeses(${documentTypesId})`,
    'rpa_RelatedOnlineSubmissionId@odata.bind': `/rpa_onlinesubmissions(${onlineSubmissionId})`
  }
  if (mimeType) {
    metadataPayload.rpa_filemimetype = mimeType
  }

  return {
    caseId,
    onlineSubmissionId,
    rpaOnlinesubmissionid,
    // Used only if the changeset is suppressed and this file's metadata must
    // be written on its own, via the same shape createMetadataForOnlineSubmission expects.
    fallbackMetadata: { name, blobFileId, mimeType, documentTypeId: documentTypesId },
    parts: [
      { method: 'PATCH', url: `${baseUrl}/incidents(${caseId})`, headers: { 'If-None-Match': '*' }, body: casePayload },
      { method: 'PATCH', url: `${baseUrl}/rpa_onlinesubmissions(${onlineSubmissionId})`, headers: { 'If-None-Match': '*' }, body: onlineSubmissionPayload },
      { method: 'PATCH', url: `${baseUrl}/rpa_activitymetadatas(${metadataId})`, headers: { 'If-None-Match': '*' }, body: metadataPayload }
    ]
  }
}

/**
 * Issues the case creation changeset and resolves a 412 into a suppressed
 * success. A 412 means a previous attempt already committed all three parts
 * — the redelivery-after-timeout case this exists to fix. Because the
 * changeset is atomic, that also means THIS file's metadata record was
 * written in that same earlier attempt only if it was the original
 * creator's file: a different file taking over creation (see the
 * creator-role recovery this composes with) derives the same case and
 * online submission keys but a different metadata key, so its record is
 * still genuinely new and must be written separately — the same call a
 * sibling file already makes once the case exists, so the suppressed path
 * and the sibling path converge on one code path rather than two.
 *
 * Anything other than a 412 is rethrown to the caller unchanged.
 */
const writeCaseChangesetOrSuppress = async ({ authToken, correlationId, fileId, caseId, onlineSubmissionId, rpaOnlinesubmissionid, fallbackMetadata, parts }) => {
  const baseUrl = getBaseUrl()
  const { headers: batchHeaders, body: batchBody } = buildChangesetRequest(parts)

  try {
    const response = await httpClient(`${baseUrl}/$batch`, {
      method: 'POST',
      headers: { Authorization: authToken, ...batchHeaders },
      body: batchBody
    })

    const responseText = await response.text()
    const parsedParts = parseBatchResponse(responseText)

    // A malformed batch body (missing CRLF framing, most likely) is parsed by
    // Dataverse as containing zero parts and answered with an outer 200 —
    // indistinguishable from success unless the part count is checked.
    if (parsedParts.length !== parts.length || parsedParts.some((part) => part.status !== HTTP_NO_CONTENT)) {
      throw new Error(`Malformed $batch response: expected ${parts.length} successful parts, got ${JSON.stringify(parsedParts)}`)
    }

    return { caseId, rpaOnlinesubmissionid, error: null }
  } catch (err) {
    if (!(err instanceof HttpError) || err.cause?.status !== HTTP_PRECONDITION_FAILED) {
      throw err
    }
  }

  logCaseCreationSuppressed({ caseId, correlationId, fileId })
  const { error: metadataError } = await createMetadataForOnlineSubmission({
    authToken,
    onlineSubmissionActivityId: onlineSubmissionId,
    metadata: fallbackMetadata,
    correlationId,
    fileId
  })
  if (metadataError) {
    throw metadataError
  }

  // rpaOnlinesubmissionid was freshly generated for this attempt but never
  // written — the 412 means an earlier attempt's changeset already persisted
  // (a different) value. Returning null avoids advertising an identifier
  // that does not exist in Dataverse.
  return { caseId, rpaOnlinesubmissionid: null, error: null }
}

/**
 * Creates a case, its online submission and the creating file's metadata
 * record as one atomic, idempotent write.
 *
 * The three records are addressed by keys derived from correlationId (and,
 * for the metadata record, fileId — see deriveMetadataRecordId), and issued
 * as a single Dataverse $batch changeset with If-None-Match: * on every
 * part. Dataverse cannot apply a conditional upsert to a deep insert (a
 * create-with-nested-children request), which is why this is three separate
 * PATCHes in one changeset rather than one POST: the changeset gives back
 * the atomicity the deep insert used to provide, while each part remains
 * individually addressable and safe to repeat. See writeCaseChangesetOrSuppress
 * for what happens when Dataverse reports the changeset already applied.
 *
 * @returns {Promise<{caseId: string, rpaOnlinesubmissionid: string|null, error: null}
 *   | {caseId: null, error: Error}>}
 */
const createCaseWithOnlineSubmission = async (request) => {
  const { authToken, correlationId, fileId, case: caseData, onlineSubmissionActivity, filesInBatch } = request

  try {
    // Without both identifiers the derived keys would be stable but
    // meaningless, and every submission missing one would collide onto a
    // single incident.
    if (!correlationId || !fileId) {
      throw new Error(`Cannot derive stable record keys: correlationId and fileId are both required, got '${correlationId}' and '${fileId}'`)
    }

    const changeset = buildCaseChangeset({ correlationId, fileId, caseData, onlineSubmissionActivity, filesInBatch })

    return await writeCaseChangesetOrSuppress({
      authToken,
      correlationId,
      fileId,
      caseId: changeset.caseId,
      onlineSubmissionId: changeset.onlineSubmissionId,
      rpaOnlinesubmissionid: changeset.rpaOnlinesubmissionid,
      fallbackMetadata: changeset.fallbackMetadata,
      parts: changeset.parts
    })
  } catch (err) {
    await attachCrmErrorBody(err)
    // Known even when the write itself failed, since it is derived rather
    // than read from a response. Lets the caller log which case a failure
    // relates to without waiting for a successful attempt.
    if (correlationId) {
      err.derivedCaseId = deriveCaseRecordId(correlationId)
    }
    return {
      caseId: null,
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

  const baseUrl = getBaseUrl()
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

export {
  getContactIdFromCrn,
  getAccountIdFromSbi,
  createCaseWithOnlineSubmission,
  getOnlineSubmissionActivityId,
  createMetadataForOnlineSubmission,
  createIntegrationInboundQueueRecord,
  getDocumentTypeMetadata,
  deriveMetadataRecordId,
  deriveCaseRecordId,
  deriveOnlineSubmissionRecordId,
  deriveIntegrationInboundQueueRecordId
}
