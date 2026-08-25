import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import convict from 'convict'
import { casesConfig } from '../../../src/config/cases.js'

describe('src/config/cases.js', () => {
  const ORIGINAL_ENV = process.env.CASE_CREATION_DEADLINE_MS

  beforeEach(() => {
    delete process.env.CASE_CREATION_DEADLINE_MS
  })

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.CASE_CREATION_DEADLINE_MS
    } else {
      process.env.CASE_CREATION_DEADLINE_MS = ORIGINAL_ENV
    }
  })

  test('defaults creationDeadlineMs to 30000', () => {
    const config = convict(casesConfig)

    expect(config.get('cases.creationDeadlineMs')).toBe(30000)
  })

  test('honours CASE_CREATION_DEADLINE_MS override', () => {
    process.env.CASE_CREATION_DEADLINE_MS = '90000'

    const config = convict(casesConfig)

    expect(config.get('cases.creationDeadlineMs')).toBe(90000)
  })

  test('rejects a value below the minimum', () => {
    process.env.CASE_CREATION_DEADLINE_MS = '999'

    const config = convict(casesConfig)

    expect(() => config.validate()).toThrow(/must be an integer >= 1000/)
  })

  test('rejects a non-integer value', () => {
    process.env.CASE_CREATION_DEADLINE_MS = '1000.5'

    const config = convict(casesConfig)

    expect(() => config.validate()).toThrow(/must be an integer >= 1000/)
  })
})
