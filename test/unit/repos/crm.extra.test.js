import { describe, test, expect } from 'vitest'

const { buildQuery, buildActivityMetadataItem, buildOnlineSubmissionEntry, buildCreateCasePayload } = await import('../../../src/repos/crm.js')

describe('crm repo helpers (extra)', () => {
  test('buildQuery preserves commas and equals after encoding', () => {
    const q = buildQuery({ 'k,v': "a=b,c=d" })
    // implementation preserves commas and equals in values (not keys)
    expect(q).toContain('k%2Cv=')
    expect(q).toContain("a=b,c=d")
  })

  test('buildActivityMetadataItem includes mimeType when provided', () => {
    const item = buildActivityMetadataItem({ name: 'file.pdf', blobFileId: 'blob-1', mimeType: 'application/pdf', documentTypeId: 'doc-1' })
    expect(item.rpa_name).toBe('file.pdf')
    expect(item.rpa_blobfileid).toBe('blob-1')
    expect(item.rpa_filemimetype).toBe('application/pdf')
    expect(item['rpa_DocumentTypeMetaId@odata.bind']).toContain('doc-1')
  })

  test('buildActivityMetadataItem omits mimeType when not provided', () => {
    const item = buildActivityMetadataItem({ name: 'file2', blobFileId: 'b2' })
    expect(item.rpa_name).toBe('file2')
    expect(item.rpa_filemimetype).toBeUndefined()
  })

  test('buildOnlineSubmissionEntry and buildCreateCasePayload produce expected structure', () => {
    const metadataItem = buildActivityMetadataItem({ name: 'doc', blobFileId: 'b3' })
    const online = buildOnlineSubmissionEntry({ subject: 's', description: 'd', scheduledStart: '2026-01-01T00:00:00Z', scheduledEnd: '2026-01-01T01:00:00Z', stateCode: 0, statusCode: 1 }, metadataItem)
    expect(online.subject).toBe('s')
    expect(online.rpa_onlinesubmissionid).toHaveLength(20)
    expect(Array.isArray(online.rpa_onlinesubmission_rpa_activitymetadata)).toBeTruthy()

    const payload = buildCreateCasePayload({ title: 'T', caseDescription: 'D', contactId: 'c1', accountId: 'a1' }, { subject: 's' }, metadataItem)
    expect(payload.title).toBe('T')
    expect(payload['customerid_contact@odata.bind']).toBe('/contacts(c1)')
    expect(payload['rpa_Organisation@odata.bind']).toBe('/accounts(a1)')
    expect(payload.incident_rpa_onlinesubmissions).toBeInstanceOf(Array)
  })
})
