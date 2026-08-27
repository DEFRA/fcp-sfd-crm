import { describe, test, expect } from 'vitest'
import { caseCreationMetrics } from '../../../src/constants/case-creation-metrics.js'

describe('src/constants/case-creation-metrics.js', () => {
  test('exposes the case creation metrics literals', () => {
    expect(caseCreationMetrics).toEqual({
      WAITING_FOR_CASE: 'crm.case.waiting_for_case',
      CREATOR_ROLE_CLAIMED: 'crm.case.creator_role_claimed',
      CREATOR_ROLE_RELEASED: 'crm.case.creator_role_released',
      CREATOR_RELEASE_FAILED: 'crm.case.creator_release_failed'
    })
  })

  test('WAITING_FOR_CASE metric is correctly defined', () => {
    expect(caseCreationMetrics.WAITING_FOR_CASE).toBe('crm.case.waiting_for_case')
  })

  test('CREATOR_ROLE_CLAIMED metric is correctly defined', () => {
    expect(caseCreationMetrics.CREATOR_ROLE_CLAIMED).toBe('crm.case.creator_role_claimed')
  })

  test('CREATOR_ROLE_RELEASED metric is correctly defined', () => {
    expect(caseCreationMetrics.CREATOR_ROLE_RELEASED).toBe('crm.case.creator_role_released')
  })

  test('CREATOR_RELEASE_FAILED metric is correctly defined', () => {
    expect(caseCreationMetrics.CREATOR_RELEASE_FAILED).toBe('crm.case.creator_release_failed')
  })

  test('all metrics follow the naming convention', () => {
    Object.values(caseCreationMetrics).forEach((metric) => {
      expect(metric).toMatch(/^crm\.case\./)
    })
  })
})
