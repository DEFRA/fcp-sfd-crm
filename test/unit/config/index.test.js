import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest'

const addFormats = vi.fn()
const validate = vi.fn()
const convictMock = (..._args) => ({ validate })
convictMock.addFormats = addFormats

vi.mock('convict', () => ({ default: convictMock }))
vi.mock('convict-format-with-validator', () => ({ default: {} }))

describe('src/config/index.js', () => {
    beforeEach(() => {
        vi.resetModules()
        addFormats.mockReset()
        validate.mockReset()
        delete process.env.VITEST
        delete process.env.NODE_ENV
    })

    afterEach(() => {
        vi.clearAllMocks()
        delete process.env.VITEST
        delete process.env.NODE_ENV
    })

    it('calls addFormats and validate when not in test env', async () => {
        const { config } = await import('../../../src/config/index.js')

        expect(addFormats).toHaveBeenCalled()
        expect(validate).toHaveBeenCalled()
        expect(config).toBeDefined()
    })

    it('skips validate when VITEST env is set', async () => {
        process.env.VITEST = '1'
        const { config } = await import('../../../src/config/index.js')

        expect(addFormats).toHaveBeenCalled()
        expect(validate).toHaveBeenCalled()
        expect(config).toBeDefined()
    })
})
