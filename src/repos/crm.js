import { randomBytes } from 'node:crypto'
import { config } from '../config/index.js'
import { httpClient } from '../http/client.js'
import { snsClient } from '../messaging/sns/client.js'
import { publish } from '../messaging/sns/publish.js'
import { sendAuditEvent } from '../messaging/outbound/audit/send-audit-event.js'
import { buildReceivedEvent } from '../messaging/outbound/received-event/build-received-event.js'

const baseUrl = config.get('crm.baseUrl')
const DEFAULT_DOCUMENT_TYPE_ID = '4e88916b-aae2-ee11-904c-000d3adc1ec9'

const CRM_EVENTS_TOPIC_KEY = 'messaging.crmEvents.topicArn'

const baseHeaders = {
  'Content-Type': 'application/json',
  Prefer: 'return=representation'
}

const noop = () => { }

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

const getContactIdFromCrn = async (authToken, crn, context = {}) => {
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
    const contactId = responseJson.value[0]?.contactid ?? null

    // Emit a person/read event so downstream systems know a person was resolved
    // for this CRN. Also emit an audit copy to the audit publisher. Failures
    // in audit emission must never affect business flow.
    if (contactId) {
      try {
        const event = buildReceivedEvent({ data: { contactId, accounts: { crn }, correlationId: context?.correlationId } }, 'uk.gov.fcp.sfd.person.read')
        const snsTopic = config.get(CRM_EVENTS_TOPIC_KEY)
        // Publish to CRM topic (fire-and-forget)
        setImmediate(() => {
          publish(snsClient, snsTopic, event).catch(err => {
            import('../logging/logger.js').then(m => m.createLogger().error({ err, contactId, crn }, 'Error publishing person.read event')).catch(noop)
          })
        })

        // Also emit audit event (background) but don't let failures bubble up
        setImmediate(() => {
          sendAuditEvent(event).catch(err => {
            const reason = String(err?.message || '').toLowerCase().includes('schema') ? 'schema' : 'transport'
            import('../logging/logger.js').then(m => m.createLogger().error({ event: { type: event.type, reference: event.data?.correlationId ?? null, reason } }, 'audit_publish_failed')).catch(noop)
          })
        })
      } catch (err) {
        // swallow publish/build errors but log asynchronously
        import('../logging/logger.js').then(m => m.createLogger().error({ err, contactId, crn }, 'Failed to build or publish person.read event')).catch(noop)
      }
    } else {
      try {
        const failEvent = buildReceivedEvent({ data: { contactId: null, accounts: { crn }, audit: { status: 'failure', details: 'CRN not found' }, correlationId: context?.correlationId } }, 'uk.gov.fcp.sfd.person.read')
        const snsTopic = config.get(CRM_EVENTS_TOPIC_KEY)
        // Publish failure to CRM topic (fire-and-forget) and emit audit event
        setImmediate(() => {
          publish(snsClient, snsTopic, failEvent).catch(err => {
            import('../logging/logger.js').then(m => m.createLogger().error({ err, crn }, 'Error publishing person.read failure event')).catch(noop)
          })
        })

        // Audit emission must happen before business error is surfaced; do it
        // but swallow audit errors so business flow continues.
        try {
          await sendAuditEvent(failEvent)
        } catch (err) {
          const reason = String(err?.message || '').toLowerCase().includes('schema') ? 'schema' : 'transport'
          import('../logging/logger.js').then(m => m.createLogger().error({ event: { type: failEvent.type, reference: failEvent.data?.correlationId ?? null, reason } }, 'audit_publish_failed')).catch(noop)
        }
      } catch (err) {
        import('../logging/logger.js').then(m => m.createLogger().error({ err, crn }, 'Failed to build or publish person.read failure event')).catch(noop)
      }
    }

    return { contactId }
  } catch (err) {
    return {
      contactId: null,
      error: err
    }
  }
}

// get business from SBI - we can also get FRN from here if needed
const getAccountIdFromSbi = async (authToken, sbi, context = {}) => {
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

    const accountId = responseJson.value[0]?.accountid ?? null

    // Emit a business/read event so downstream systems know a business/account
    // was resolved for this SBI. Also emit an audit copy. Audit failures must
    // not affect business flow.
    if (accountId) {
      try {
        const event = buildReceivedEvent({ data: { accountId, accounts: { sbi }, correlationId: context?.correlationId } }, 'uk.gov.fcp.sfd.business.read')
        const snsTopic = config.get(CRM_EVENTS_TOPIC_KEY)
        // Publish to CRM topic (fire-and-forget)
        Promise.resolve(publish(snsClient, snsTopic, event)).catch(err => {
          import('../logging/logger.js').then(m => m.createLogger().error({ err, accountId, sbi }, 'Error publishing business.read event')).catch(noop)
        })

        setImmediate(() => {
          sendAuditEvent(event).catch(err => {
            const reason = String(err?.message || '').toLowerCase().includes('schema') ? 'schema' : 'transport'
            import('../logging/logger.js').then(m => m.createLogger().error({ event: { type: event.type, reference: event.data?.correlationId ?? null, reason } }, 'audit_publish_failed')).catch(noop)
          })
        })
      } catch (err) {
        import('../logging/logger.js').then(m => m.createLogger().error({ err, accountId, sbi }, 'Failed to build or publish business.read event')).catch(noop)
      }
    } else {
      try {
        const failEvent = buildReceivedEvent({ data: { accountId: null, accounts: { sbi }, audit: { status: 'failure', details: 'SBI not found' }, correlationId: context?.correlationId } }, 'uk.gov.fcp.sfd.business.read')
        const snsTopic = config.get(CRM_EVENTS_TOPIC_KEY)
        setImmediate(() => {
          publish(snsClient, snsTopic, failEvent).catch(err => {
            import('../logging/logger.js').then(m => m.createLogger().error({ err, sbi }, 'Error publishing business.read failure event')).catch(noop)
          })
        })

        // Audit emission must happen before business error surfaced
        try {
          await sendAuditEvent(failEvent)
        } catch (err) {
          const reason = String(err?.message || '').toLowerCase().includes('schema') ? 'schema' : 'transport'
          import('../logging/logger.js').then(m => m.createLogger().error({ event: { type: failEvent.type, reference: failEvent.data?.correlationId ?? null, reason } }, 'audit_publish_failed')).catch(noop)
        }
      } catch (err) {
        import('../logging/logger.js').then(m => m.createLogger().error({ err, sbi }, 'Failed to build or publish business.read failure event')).catch(noop)
      }
    }

    return { accountId }
  } catch (err) {
    return {
      accountId: null,
      error: err
    }
  }
}

const buildActivityMetadataItem = ({ name, blobFileId, mimeType, documentTypeId }) => {
  const item = {
    rpa_name: name,
    rpa_blobfileid: blobFileId,
    'rpa_DocumentTypeMetaId@odata.bind': `/rpa_documenttypeses(${documentTypeId || DEFAULT_DOCUMENT_TYPE_ID})`
  }

  if (mimeType) {
    item.rpa_filemimetype = mimeType
  }
  return item
}

const buildOnlineSubmissionEntry = (onlineSubmissionActivity, activityMetadataItem) => {
  const { subject, description, scheduledStart, scheduledEnd, stateCode, statusCode } = onlineSubmissionActivity
  return {
    subject,
    description,
    scheduledstart: scheduledStart,
    scheduledend: scheduledEnd,
    rpa_onlinesubmissiondate: new Date().toISOString(),
    rpa_onlinesubmissionid: randomBytes(10).toString('hex'),
    statecode: stateCode,
    statuscode: statusCode,
    rpa_onlinesubmission_rpa_activitymetadata: [activityMetadataItem]
  }
}

const buildCreateCasePayload = (caseData, onlineSubmissionActivity, activityMetadataItem) => {
  const { title, caseDescription, contactId, accountId } = caseData
  const onlinesubmission = buildOnlineSubmissionEntry(onlineSubmissionActivity, activityMetadataItem)

  return {
    title,
    description: caseDescription,
    caseorigincode: 100000002,
    prioritycode: 2,
    'customerid_contact@odata.bind': `/contacts(${contactId})`,
    'rpa_Contact@odata.bind': `/contacts(${contactId})`,
    'rpa_Organisation@odata.bind': `/accounts(${accountId})`,
    rpa_isunknowncontact: false,
    rpa_isunknownorganisation: false,
    incident_rpa_onlinesubmissions: [onlinesubmission]
  }
}

const createCaseWithOnlineSubmission = async (request) => {
  try {
    const { authToken, case: caseData, onlineSubmissionActivity } = request
    const { metadata } = onlineSubmissionActivity

    const activityMetadataItem = buildActivityMetadataItem(metadata)
    const payload = buildCreateCasePayload(caseData, onlineSubmissionActivity, activityMetadataItem)

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

    const payload = buildExistingCaseMetadataPayload(metadata)
    const result = await postMetadataForCase(authToken, caseId, payload)

    return {
      metadataId: result?.rpa_activitymetadataid || null,
      error: null
    }
  } catch (err) {
    return {
      metadataId: null,
      error: err
    }
  }
}

const buildExistingCaseMetadataPayload = (metadata) => {
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

  return payload
}

const postMetadataForCase = async (authToken, caseId, payload) => {
  const endpoint = `${baseUrl}/incidents(${caseId})/incident_rpa_activitymetadata`

  const response = await httpClient(endpoint, {
    method: 'POST',
    headers: {
      Authorization: authToken,
      ...baseHeaders
    },
    body: JSON.stringify(payload)
  })

  return response.json()
}

// Future: get document type
export {
  getContactIdFromCrn,
  getAccountIdFromSbi,
  createCaseWithOnlineSubmission,
  getOnlineSubmissionId,
  createMetadataForOnlineSubmission
  ,
  createMetadataForExistingCase,
  // exported for testing
  buildQuery,
  buildActivityMetadataItem,
  buildOnlineSubmissionEntry,
  buildCreateCasePayload
}
