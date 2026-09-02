import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import convict from 'convict'
import { crmConfig } from '../../../src/config/crm.js'

describe('src/config/crm.js', () => {
  const ORIGINAL_VALUE = process.env.CRM_INTEGRATION_INBOUND_FAILURE_PROCESSING_ENTITY

  beforeEach(() => {
    delete process.env.CRM_INTEGRATION_INBOUND_FAILURE_PROCESSING_ENTITY
  })

  afterEach(() => {
    if (ORIGINAL_VALUE === undefined) {
      delete process.env.CRM_INTEGRATION_INBOUND_FAILURE_PROCESSING_ENTITY
    } else {
      process.env.CRM_INTEGRATION_INBOUND_FAILURE_PROCESSING_ENTITY = ORIGINAL_VALUE
    }
  })

  test('defaults integrationInboundFailureProcessingEntity to empty string', () => {
    const config = convict(crmConfig)

    expect(config.get('crm.integrationInboundFailureProcessingEntity')).toBe('')
  })

  test('honours CRM_INTEGRATION_INBOUND_FAILURE_PROCESSING_ENTITY override', () => {
    process.env.CRM_INTEGRATION_INBOUND_FAILURE_PROCESSING_ENTITY = '927350008'

    const config = convict(crmConfig)

    expect(config.get('crm.integrationInboundFailureProcessingEntity')).toBe('927350008')
  })
})
