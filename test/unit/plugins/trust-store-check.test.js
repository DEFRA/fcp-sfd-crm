import { afterEach, describe, expect, test, vi } from 'vitest'
import hapi from '@hapi/hapi'
import { secureContext } from '@defra/hapi-secure-context'

import { config } from '../../../src/config/index.js'
import { trustStoreCheck } from '../../../src/plugins/trust-store-check.js'

const createServer = (customCACerts) => {
  const server = hapi.server()
  server.decorate('server', 'customCACerts', customCACerts)
  return server
}

describe('trustStoreCheck plugin', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    config.set('cdpEnvironment', 'local')
  })

  test('passes when every TRUSTSTORE_ variable was loaded', async () => {
    vi.stubEnv('TRUSTSTORE_CDP_ROOT_CA', 'encoded-cert')
    config.set('cdpEnvironment', 'dev')

    const server = createServer({ TRUSTSTORE_CDP_ROOT_CA: 'cert' })

    await expect(server.register(trustStoreCheck)).resolves.not.toThrow()
  })

  test('fails naming each TRUSTSTORE_ variable that was not loaded', async () => {
    vi.stubEnv('TRUSTSTORE_CDP_ROOT_CA', 'encoded-cert')
    vi.stubEnv('TRUSTSTORE_RDS_ROOT_CA', 'not-a-cert')

    const server = createServer({ TRUSTSTORE_CDP_ROOT_CA: 'cert' })

    await expect(server.register(trustStoreCheck)).rejects.toThrow('Invalid CA certificate in TRUSTSTORE_RDS_ROOT_CA')
  })

  test('fails outside local when no certificates were loaded', async () => {
    config.set('cdpEnvironment', 'dev')

    const server = createServer({})

    await expect(server.register(trustStoreCheck)).rejects.toThrow('No TRUSTSTORE_ CA certificates were loaded')
  })

  test('passes locally when no certificates are configured', async () => {
    const server = createServer({})

    await expect(server.register(trustStoreCheck)).resolves.not.toThrow()
  })

  test('treats a missing customCACerts decoration as nothing loaded', async () => {
    config.set('cdpEnvironment', 'dev')

    const server = hapi.server()

    await expect(server.register(trustStoreCheck)).rejects.toThrow('No TRUSTSTORE_ CA certificates were loaded')
  })

  test('catches a certificate the secureContext plugin skipped without logging', async () => {
    vi.stubEnv('TRUSTSTORE_BROKEN', Buffer.from('not a certificate').toString('base64'))

    const server = hapi.server()
    server.decorate('server', 'logger', { info: vi.fn() })

    await expect(server.register([secureContext, trustStoreCheck])).rejects.toThrow('Invalid CA certificate in TRUSTSTORE_BROKEN')
  })
})
