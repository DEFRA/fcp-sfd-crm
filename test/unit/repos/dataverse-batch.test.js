import { describe, test, expect } from 'vitest'
import { buildChangesetRequest, parseBatchResponse } from '../../../src/repos/dataverse-batch.js'

describe('buildChangesetRequest', () => {
  test('builds a CRLF-framed multipart/mixed batch body byte for byte', () => {
    const parts = [
      {
        method: 'PATCH',
        url: 'https://crm.example.com/api/incidents(11111111-1111-4111-8111-111111111111)',
        headers: { 'If-None-Match': '*' },
        body: { title: 'Test case' }
      },
      {
        method: 'PATCH',
        url: 'https://crm.example.com/api/rpa_onlinesubmissions(22222222-2222-4222-8222-222222222222)',
        headers: { 'If-None-Match': '*' },
        body: { subject: 'Test submission' }
      }
    ]

    const { headers, body } = buildChangesetRequest(parts, {
      batchBoundary: 'batch_test',
      changesetBoundary: 'changeset_test'
    })

    expect(headers).toEqual({ 'Content-Type': 'multipart/mixed;boundary=batch_test' })

    const expected = [
      '--batch_test',
      'Content-Type: multipart/mixed;boundary=changeset_test',
      '',
      '--changeset_test',
      'Content-Type: application/http',
      'Content-Transfer-Encoding: binary',
      'Content-ID: 1',
      '',
      'PATCH https://crm.example.com/api/incidents(11111111-1111-4111-8111-111111111111) HTTP/1.1',
      'Content-Type: application/json',
      'If-None-Match: *',
      '',
      '{"title":"Test case"}',
      '',
      '--changeset_test',
      'Content-Type: application/http',
      'Content-Transfer-Encoding: binary',
      'Content-ID: 2',
      '',
      'PATCH https://crm.example.com/api/rpa_onlinesubmissions(22222222-2222-4222-8222-222222222222) HTTP/1.1',
      'Content-Type: application/json',
      'If-None-Match: *',
      '',
      '{"subject":"Test submission"}',
      '',
      '--changeset_test--',
      '',
      '--batch_test--',
      ''
    ].join('\r\n')

    expect(body).toBe(expected)
    expect(body.includes('\n') && !body.includes('\r\n')).toBe(false)
    expect(body.split('\n').every((line, i, arr) => i === arr.length - 1 || line.endsWith('\r'))).toBe(true)
  })

  test('generates distinct random boundaries when none are supplied', () => {
    const parts = [{ method: 'PATCH', url: 'https://x/y(1)', body: {} }]
    const first = buildChangesetRequest(parts)
    const second = buildChangesetRequest(parts)

    expect(first.headers['Content-Type']).not.toBe(second.headers['Content-Type'])
    expect(first.headers['Content-Type']).toMatch(/^multipart\/mixed;boundary=batch_[0-9a-f-]+$/)
  })

  test('omits the header block entirely for a part with no extra headers', () => {
    const { body } = buildChangesetRequest(
      [{ method: 'PATCH', url: 'https://x/y(1)', body: { a: 1 } }],
      { batchBoundary: 'b', changesetBoundary: 'c' }
    )

    expect(body).toContain('PATCH https://x/y(1) HTTP/1.1\r\nContent-Type: application/json\r\n\r\n{"a":1}')
  })
})

describe('parseBatchResponse', () => {
  test('parses three successful 204 parts from a changeset response', () => {
    const text = [
      '--batchresponse_999',
      'Content-Type: multipart/mixed; boundary=changesetresponse_abc',
      '',
      '--changesetresponse_abc',
      'Content-Type: application/http',
      'Content-Transfer-Encoding: binary',
      'Content-ID: 1',
      '',
      'HTTP/1.1 204 No Content',
      'OData-Version: 4.0',
      '',
      '',
      '--changesetresponse_abc',
      'Content-Type: application/http',
      'Content-Transfer-Encoding: binary',
      'Content-ID: 2',
      '',
      'HTTP/1.1 204 No Content',
      'OData-Version: 4.0',
      '',
      '',
      '--changesetresponse_abc',
      'Content-Type: application/http',
      'Content-Transfer-Encoding: binary',
      'Content-ID: 3',
      '',
      'HTTP/1.1 204 No Content',
      'OData-Version: 4.0',
      '',
      '',
      '--changesetresponse_abc--',
      '--batchresponse_999--'
    ].join('\r\n')

    const parsed = parseBatchResponse(text)

    expect(parsed).toHaveLength(3)
    expect(parsed.map((p) => p.contentId)).toEqual(['1', '2', '3'])
    expect(parsed.every((p) => p.status === 204)).toBe(true)
  })

  test('parses a single 412 part with its error body', () => {
    const text = [
      '--batchresponse_1',
      'Content-Type: multipart/mixed; boundary=changesetresponse_xyz',
      '',
      '--changesetresponse_xyz',
      'Content-Type: application/http',
      'Content-Transfer-Encoding: binary',
      'Content-ID: 1',
      '',
      'HTTP/1.1 412 Precondition Failed',
      'Content-Type: application/json; odata.metadata=minimal',
      '',
      '{"error":{"code":"0x80040237","message":"A record with matching key values already exists."}}',
      '--changesetresponse_xyz--',
      '--batchresponse_1--'
    ].join('\r\n')

    const parsed = parseBatchResponse(text)

    expect(parsed).toHaveLength(1)
    expect(parsed[0]).toMatchObject({ contentId: '1', status: 412, statusText: 'Precondition Failed' })
    expect(parsed[0].body).toContain('0x80040237')
  })

  test('returns no parts for a malformed response with no changeset boundary, rather than guessing', () => {
    const text = '--batchresponse_empty\r\n--batchresponse_empty--\r\n'

    expect(parseBatchResponse(text)).toEqual([])
  })
})
