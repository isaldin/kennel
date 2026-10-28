import { describe, expect, it } from 'vitest'
import { AuditScheduler } from '../src/main/audit/scheduler'

const NOW = new Date('2026-10-17T12:00:00Z')
const hoursAgo = (h: number): string => new Date(NOW.getTime() - h * 3_600_000).toISOString()

function scheduler(
  lastRuns: Record<number, string | null>,
  running = false,
  periodMs?: () => number | null
): { tick(): void; started: number[] } {
  const started: number[] = []
  const s = new AuditScheduler({
    serverIds: () => Object.keys(lastRuns).map(Number),
    lastRunAt: (id) => lastRuns[id],
    isRunning: () => running,
    start: (id) => started.push(id),
    now: () => NOW,
    periodMs
  })
  return { tick: () => s.tick(), started }
}

describe('AuditScheduler', () => {
  it('never auto-starts a server that was never audited by hand', () => {
    const s = scheduler({ 1: null })
    s.tick()
    expect(s.started).toEqual([])
  })

  it('waits until 24 hours have passed since the last run', () => {
    const s = scheduler({ 1: hoursAgo(23) })
    s.tick()
    expect(s.started).toEqual([])
  })

  it('starts one due server per tick', () => {
    const s = scheduler({ 1: hoursAgo(2), 2: hoursAgo(30), 3: hoursAgo(48) })
    s.tick()
    expect(s.started).toEqual([2])
  })

  it('does not start while another audit is running', () => {
    const s = scheduler({ 1: hoursAgo(48) }, true)
    s.tick()
    expect(s.started).toEqual([])
  })

  it('uses the configured period', () => {
    const s = scheduler({ 1: hoursAgo(7) }, false, () => 6 * 3_600_000)
    s.tick()
    expect(s.started).toEqual([1])
  })

  it('does nothing when automatic audits are off', () => {
    const s = scheduler({ 1: hoursAgo(1000) }, false, () => null)
    s.tick()
    expect(s.started).toEqual([])
  })
})
