import { beforeEach, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../src/main/db'
import { Repo } from '../src/main/repo'
import { AuditRepo } from '../src/main/audit/auditRepo'
import { DEFAULT_THRESHOLDS, type Finding, type Snapshot } from '../src/shared/audit'
import type { ServerInput } from '../src/shared/types'

const SERVER: ServerInput = {
  name: 's1',
  provider: '',
  host: '10.0.0.1',
  port: 22,
  username: 'root',
  sshAlias: '',
  identityFile: '',
  enpassItemUuid: '',
  monthlyCost: 5,
  currency: 'EUR',
  billingDay: null,
  project: '',
  panelUrl: '',
  notes: ''
}

function snapshot(serverId: number, takenAt: string): Snapshot {
  return {
    serverId,
    takenAt,
    host: null,
    disks: [],
    containers: [],
    units: [],
    ports: [],
    vhosts: [],
    certs: [],
    cron: [],
    unavailable: []
  }
}

const FINDING: Finding = {
  key: 'disk_full:1:/',
  serverId: 1,
  severity: 'warning',
  title: 'Диск заполнен',
  explanation: '',
  evidenceRefs: [],
  suggestedQuestion: '',
  suggestedAction: '',
  source: 'rule',
  code: 'disk_full',
  registryCandidate: null
}

describe('AuditRepo', () => {
  let db: Db
  let repo: Repo
  let audit: AuditRepo

  beforeEach(() => {
    db = openDb(':memory:')
    repo = new Repo(db)
    audit = new AuditRepo(db)
  })

  it('returns recent snapshots newest first, limited', () => {
    const { id } = repo.createServer(SERVER)
    audit.saveSnapshot(snapshot(id, '2026-10-01T00:00:00.000Z'))
    audit.saveSnapshot(snapshot(id, '2026-10-03T00:00:00.000Z'))
    audit.saveSnapshot(snapshot(id, '2026-10-02T00:00:00.000Z'))
    const recent = audit.recentSnapshots(id, 2)
    expect(recent.map((s) => s.takenAt)).toEqual([
      '2026-10-03T00:00:00.000Z',
      '2026-10-02T00:00:00.000Z'
    ])
  })

  it('deletes snapshots together with the server', () => {
    const { id } = repo.createServer(SERVER)
    audit.saveSnapshot(snapshot(id, '2026-10-01T00:00:00.000Z'))
    repo.removeServer(id)
    expect(audit.recentSnapshots(id, 10)).toEqual([])
  })

  it('keeps runs per server: latest, lastFinishedAt and the previous done run', () => {
    const a = repo.createServer(SERVER).id
    const b = repo.createServer({ ...SERVER, name: 's2' }).id
    expect(audit.latestRun(a)).toBeNull()
    expect(audit.lastFinishedAt(a)).toBeNull()

    const first = audit.createRun('manual', a)
    audit.saveRun({ ...first, status: 'done', finishedAt: '2026-10-15T00:00:00.000Z' })
    const failed = audit.createRun('manual', a)
    audit.saveRun({ ...failed, status: 'failed', finishedAt: '2026-10-16T00:00:00.000Z' })
    const other = audit.createRun('manual', b)
    audit.saveRun({ ...other, status: 'done', finishedAt: '2026-10-17T00:00:00.000Z' })
    const current = audit.createRun('scheduled', a)

    expect(audit.latestRun(a)!.id).toBe(current.id)
    expect(audit.latestRun(b)!.id).toBe(other.id)
    expect(audit.lastFinishedAt(a)).toBe('2026-10-15T00:00:00.000Z')
    expect(audit.previousDone(a, current.id)!.id).toBe(first.id)
    expect(audit.previousDone(a, first.id)).toBeNull()
  })

  it('deletes runs together with the server', () => {
    const { id } = repo.createServer(SERVER)
    audit.createRun('manual', id)
    repo.removeServer(id)
    expect(audit.latestRun(id)).toBeNull()
  })

  it('marks runs left unfinished by a previous session as failed', () => {
    const { id } = repo.createServer(SERVER)
    const done = audit.createRun('manual', id)
    audit.saveRun({ ...done, status: 'done', finishedAt: '2026-10-16T00:00:00.000Z' })
    const stuck = audit.createRun('scheduled', id)
    audit.saveRun({ ...stuck, status: 'awaiting_confirmation', pendingCommands: [] })
    audit.failInterrupted('2026-10-17T00:00:00.000Z')
    expect(audit.getRun(done.id).status).toBe('done')
    expect(audit.getRun(stuck.id)).toMatchObject({
      status: 'failed',
      finishedAt: '2026-10-17T00:00:00.000Z',
      analyzerError: 'Прервано: приложение было закрыто'
    })
  })

  it('round-trips run data', () => {
    const { id } = repo.createServer(SERVER)
    const run = audit.createRun('scheduled', id)
    expect(run).toMatchObject({
      serverId: id,
      trigger: 'scheduled',
      status: 'collecting',
      round: 0
    })
    const saved = { ...run, findings: [FINDING], analyzerError: 'x' }
    audit.saveRun(saved)
    expect(audit.latestRun(id)).toEqual(saved)
  })

  it('overwrites decisions by key', () => {
    audit.setDecision('k', { kind: 'keep', until: null, note: '' })
    const d = audit.setDecision('k', { kind: 'ignore_until', until: '2026-11-01', note: '' })
    expect(d).toMatchObject({ key: 'k', kind: 'ignore_until', until: '2026-11-01' })
    expect(audit.listDecisions()).toHaveLength(1)
    expect(audit.listDecisions()[0].kind).toBe('ignore_until')
  })

  it('stores the automatic audit period and rejects unknown values', () => {
    expect(audit.getAutoAuditHours()).toBe(24)
    audit.setAutoAuditHours(0)
    expect(audit.getAutoAuditHours()).toBe(0)
    expect(() => audit.setAutoAuditHours(5)).toThrow('Недопустимый период')
    expect(audit.getAutoAuditHours()).toBe(0)
  })

  it('merges thresholds over defaults', () => {
    expect(audit.getThresholds()).toEqual(DEFAULT_THRESHOLDS)
    audit.setThresholds({ ...DEFAULT_THRESHOLDS, diskPct: 90 })
    expect(audit.getThresholds().diskPct).toBe(90)
  })
})
