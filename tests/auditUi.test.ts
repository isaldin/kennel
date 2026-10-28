import { describe, expect, it } from 'vitest'
import { groupFindings, isHidden } from '../src/renderer/src/lib/audit'
import type { Decision, Finding } from '../src/shared/audit'

const NOW = new Date('2026-10-17T00:00:00Z')

const finding = (key: string, severity: Finding['severity']): Finding => ({
  key,
  serverId: 1,
  severity,
  title: key,
  explanation: '',
  evidenceRefs: [],
  suggestedQuestion: '',
  suggestedAction: '',
  source: 'rule',
  code: null,
  registryCandidate: null
})

const decision = (kind: Decision['kind'], until: string | null = null): Decision => ({
  key: 'k',
  kind,
  until,
  note: '',
  decidedAt: ''
})

describe('isHidden', () => {
  const f = finding('k', 'warning')

  it('hides snoozed and decided findings', () => {
    expect(isHidden(f, [decision('ignore_until', '2026-11-01')], NOW)).toBe(true)
    expect(isHidden(f, [decision('keep')], NOW)).toBe(true)
    expect(isHidden(f, [decision('remove_planned')], NOW)).toBe(true)
  })

  it('shows findings whose snooze has expired or that have no decision', () => {
    expect(isHidden(f, [decision('ignore_until', '2026-10-01')], NOW)).toBe(false)
    expect(isHidden(f, [], NOW)).toBe(false)
  })
})

describe('groupFindings', () => {
  it('orders groups critical → warning → info and skips empty ones', () => {
    const groups = groupFindings([
      finding('a', 'info'),
      finding('b', 'critical'),
      finding('c', 'info'),
      finding('d', 'critical')
    ])
    expect(groups.map(([severity, list]) => [severity, list.map((x) => x.key)])).toEqual([
      ['critical', ['b', 'd']],
      ['info', ['a', 'c']]
    ])
  })
})
