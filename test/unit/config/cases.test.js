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

  test('defaults creationDeadlineMs to 60000', () => {
    const config = convict(casesConfig)

    expect(config.get('cases.creationDeadlineMs')).toBe(60000)
  })

  test('honours CASE_CREATION_DEADLINE_MS override', () => {
    process.env.CASE_CREATION_DEADLINE_MS = '90000'

    const config = convict(casesConfig)

    expect(config.get('cases.creationDeadlineMs')).toBe(90000)
  })
})
