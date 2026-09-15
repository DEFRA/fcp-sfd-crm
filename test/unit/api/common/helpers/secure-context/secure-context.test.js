import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'
import tls from 'node:tls'

import { config } from '../../../../../../src/config/index.js'
import { createSecureContext } from '../../../../../../src/api/common/helpers/secure-context/secure-context.js'

const mockAddCACert = vi.fn()
const mockTlsCreateSecureContext = vi.fn()
  .mockReturnValue({ context: { addCACert: mockAddCACert } })

describe('#createSecureContext', () => {
  const logger = { info: vi.fn() }

  afterEach(() => {
    config.set('isSecureContextEnabled', false)
    vi.restoreAllMocks()
  })

  test('Should return null when secure context is disabled', () => {
    config.set('isSecureContextEnabled', false)

    expect(createSecureContext(logger)).toBeNull()
  })

  describe('When secure context is enabled', () => {
    const PROCESS_ENV = process.env

    beforeEach(() => {
      process.env = { ...PROCESS_ENV, TRUSTSTORE_ONE: 'mock-trust-store-cert-one' }
      vi.spyOn(tls, 'createSecureContext').mockImplementation(mockTlsCreateSecureContext)
      config.set('isSecureContextEnabled', true)
    })

    afterEach(() => {
      process.env = PROCESS_ENV
    })

    test('Original tls.createSecureContext should have been called', () => {
      createSecureContext(logger)

      expect(mockTlsCreateSecureContext).toHaveBeenCalledWith({})
    })

    test('addCACert should have been called', () => {
      createSecureContext(logger)

      expect(mockAddCACert).toHaveBeenCalled()
    })

    test('Should return the created secure context', () => {
      expect(createSecureContext(logger)).toEqual({
        context: { addCACert: expect.any(Function) }
      })
    })
  })

  describe('When secure context is enabled without TRUSTSTORE_ certs', () => {
    beforeEach(() => {
      config.set('isSecureContextEnabled', true)
    })

    test('Should log about not finding any TRUSTSTORE_ certs', () => {
      createSecureContext(logger)

      expect(logger.info).toHaveBeenCalledWith(
        'Could not find any TRUSTSTORE_ certificates'
      )
    })
  })
})
