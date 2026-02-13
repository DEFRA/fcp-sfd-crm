import { describe, test, expect, vi } from 'vitest'

vi.mock('../../../../../src/config/index.js', () => ({
  config: {
    get: vi.fn(() => 'test-api-key')
  }
}))

const { validateApiKeyHeader } = await import('../../../../../src/api/common/helpers/validate-api-key-header.js')

describe('validateApiKeyHeader', () => {
  test('should return h.continue when error is not about x-api-key', async () => {
    const result = validateApiKeyHeader()
    const mockH = {
      continue: Symbol('continue'),
      response: vi.fn()
    }

    const error = {
      details: [{ context: { key: 'other-field' } }]
    }

    const output = await result.failAction(null, mockH, error)

    expect(output).toBe(mockH.continue)
    expect(mockH.response).not.toHaveBeenCalled()
  })

  test('should return 401 response when error is about x-api-key', async () => {
    const result = validateApiKeyHeader()
    const mockTakeover = vi.fn()
    const mockCode = vi.fn(() => ({ takeover: mockTakeover }))
    const mockResponse = vi.fn(() => ({ code: mockCode }))
    const mockH = {
      continue: Symbol('continue'),
      response: mockResponse
    }

    const error = {
      details: [{ context: { key: 'x-api-key' } }]
    }

    await result.failAction(null, mockH, error)

    expect(mockResponse).toHaveBeenCalledWith({ error: 'Missing or invalid QA-specific x-api-key header' })
  })
})
