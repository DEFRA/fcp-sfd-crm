import { randomUUID } from 'node:crypto'

// Dataverse's multipart/mixed parser requires CRLF line endings throughout. A
// body built with bare \n is not rejected — it is silently parsed as having
// zero parts, and the outer response reads as 200 with an empty batch. Every
// join in this module must use CRLF, and parseBatchResponse must never treat
// an empty part list as success.
const CRLF = '\r\n'

/**
 * Builds a Dataverse $batch request containing a single atomic changeset.
 *
 * Each part is one write, addressed on its own entity set and carrying its
 * own conditional header (`If-None-Match: *` for the conditional upserts this
 * module exists to support). A changeset is all-or-nothing: if any part is
 * rejected, none of the parts commit. See `crm.js` for how a changeset-wide
 * 412 is used to detect an already-applied write.
 *
 * @param {Array<{method: string, url: string, headers?: Record<string,string>, body: object}>} parts
 * @param {{batchBoundary?: string, changesetBoundary?: string}} [boundaries] - override for pinned tests
 * @returns {{headers: Record<string,string>, body: string}}
 */
const buildChangesetRequest = (parts, boundaries = {}) => {
  const batchBoundary = boundaries.batchBoundary ?? `batch_${randomUUID()}`
  const changesetBoundary = boundaries.changesetBoundary ?? `changeset_${randomUUID()}`

  const changesetLines = []
  parts.forEach((part, index) => {
    changesetLines.push(
      `--${changesetBoundary}`,
      'Content-Type: application/http',
      'Content-Transfer-Encoding: binary',
      `Content-ID: ${index + 1}`,
      '',
      `${part.method} ${part.url} HTTP/1.1`,
      'Content-Type: application/json',
      ...Object.entries(part.headers ?? {}).map(([key, value]) => `${key}: ${value}`),
      '',
      JSON.stringify(part.body),
      ''
    )
  })
  changesetLines.push(`--${changesetBoundary}--`, '')

  const lines = [
    `--${batchBoundary}`,
    `Content-Type: multipart/mixed;boundary=${changesetBoundary}`,
    '',
    ...changesetLines,
    `--${batchBoundary}--`,
    ''
  ]

  return {
    headers: { 'Content-Type': `multipart/mixed;boundary=${batchBoundary}` },
    body: lines.join(CRLF)
  }
}

/**
 * Parses a Dataverse $batch response into one entry per part.
 *
 * Splits on the changeset boundary named in the response's own Content-Type,
 * not on the outer batch boundary — a successful multi-part response nests
 * the changeset responses inside a single outer part, and splitting on the
 * wrong boundary under-reports how many parts actually came back.
 *
 * An empty result is not an error in its own right — it is exactly what a
 * malformed request (see the CRLF note above) produces alongside an outer
 * 200 — so the caller must treat a response with fewer parts than were sent
 * as a failure rather than inferring success from the outer status alone.
 *
 * @param {string} responseText
 * @returns {Array<{contentId: string, status: number, statusText: string, body: string}>}
 */
const CHANGESET_BOUNDARY_PATTERN = /boundary=(changesetresponse_[0-9a-f-]+)/i
const STATUS_LINE_PATTERN = /HTTP\/1\.1 (\d{3})([^\r\n]*)/
const CONTENT_ID_PATTERN = /Content-ID:\s*(\d+)/

const parseBatchResponse = (responseText) => {
  const boundaryMatch = CHANGESET_BOUNDARY_PATTERN.exec(responseText)
  const splitter = boundaryMatch
    ? new RegExp(`--${boundaryMatch[1]}(?:--)?`)
    : /--batchresponse_[0-9a-f-]+(?:--)?/i

  const results = []
  for (const block of responseText.split(splitter)) {
    const statusMatch = STATUS_LINE_PATTERN.exec(block)
    if (!statusMatch) {
      continue
    }
    const idMatch = CONTENT_ID_PATTERN.exec(block)
    // The HTTP response embedded in this part has its own header/body split on
    // a blank line, distinct from the changeset part's own headers above it.
    const segments = block.split(/\r?\n\r?\n/)
    const bodySegment = segments.at(-1)?.trim() ?? ''
    results.push({
      contentId: idMatch ? idMatch[1] : null,
      status: Number.parseInt(statusMatch[1], 10),
      statusText: statusMatch[2].trim(),
      body: bodySegment.startsWith('{') ? bodySegment : ''
    })
  }
  return results
}

export { buildChangesetRequest, parseBatchResponse }
