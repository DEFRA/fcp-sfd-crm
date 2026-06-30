import { describe, test, expect } from 'vitest'

const { buildQuery, buildActivityMetadataItem, buildOnlineSubmissionEntry, buildCreateCasePayload } = await import('../../../src/repos/crm.js')

describe('crm helpers', () => {
    test('buildQuery encodes and preserves commas and equals', () => {
        const q = buildQuery({ $select: 'contactid', $filter: "rpa_capcustomerid eq '123,456=789'" })
        expect(q).toContain('%24select=contactid')
        expect(q).toContain("rpa_capcustomerid%20eq%20'123,456=789'")
    })

    test('buildActivityMetadataItem includes mime and documentTypeId', () => {
        const item = buildActivityMetadataItem({ name: 'file.pdf', blobFileId: 'blob-1', mimeType: 'application/pdf', documentTypeId: 'doc-1' })
        expect(item.rpa_name).toBe('file.pdf')
        expect(item.rpa_blobfileid).toBe('blob-1')
        expect(item.rpa_filemimetype).toBe('application/pdf')
        expect(item['rpa_DocumentTypeMetaId@odata.bind']).toBe('/rpa_documenttypeses(doc-1)')
    })

    test('buildActivityMetadataItem uses default document type when missing', () => {
        const item = buildActivityMetadataItem({ name: 'a', blobFileId: 'b' })
        expect(item['rpa_DocumentTypeMetaId@odata.bind']).toContain('/rpa_documenttypeses(')
    })

    test('buildOnlineSubmissionEntry builds submission with id and metadata', () => {
        const activity = { subject: 's', description: 'd', scheduledStart: '2026-01-01', scheduledEnd: '2026-01-02', stateCode: 1, statusCode: 2 }
        const meta = { rpa_name: 'f', rpa_blobfileid: 'b' }
        const entry = buildOnlineSubmissionEntry(activity, meta)
        expect(entry.subject).toBe('s')
        expect(entry.rpa_onlinesubmission_rpa_activitymetadata).toHaveLength(1)
        expect(entry.rpa_onlinesubmissionid).toHaveLength(20)
    })

    test('buildCreateCasePayload includes contact and account binds', () => {
        const caseData = { title: 'T', caseDescription: 'D', contactId: 'c1', accountId: 'a1' }
        const activity = { subject: 's', description: 'd', scheduledStart: '2026-01-01', scheduledEnd: '2026-01-02', stateCode: 1, statusCode: 2 }
        const meta = { rpa_name: 'f', rpa_blobfileid: 'b' }
        const payload = buildCreateCasePayload(caseData, activity, meta)
        expect(payload['customerid_contact@odata.bind']).toBe('/contacts(c1)')
        expect(payload['rpa_Organisation@odata.bind']).toBe('/accounts(a1)')
        expect(payload.incident_rpa_onlinesubmissions).toHaveLength(1)
    })
})
