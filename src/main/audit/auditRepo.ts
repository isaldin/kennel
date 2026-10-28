import type { Db } from '../db'
import {
  AUTO_AUDIT_HOURS,
  DEFAULT_AUTO_AUDIT_HOURS,
  DEFAULT_THRESHOLDS,
  type AuditRun,
  type Decision,
  type DecisionInput,
  type DecisionKind,
  type Snapshot,
  type Thresholds
} from '../../shared/audit'

interface RunRow {
  id: number
  server_id: number | null
  trigger: AuditRun['trigger']
  status: AuditRun['status']
  started_at: string
  finished_at: string | null
  data: string
}

interface DecisionRow {
  key: string
  kind: string
  until: string | null
  note: string
  decided_at: string
}

/** Run fields stored in the JSON `data` column; the rest have their own columns. */
type RunData = Omit<AuditRun, 'id' | 'serverId' | 'trigger' | 'status' | 'startedAt' | 'finishedAt'>

const toRun = (r: RunRow): AuditRun => ({
  id: r.id,
  serverId: r.server_id,
  trigger: r.trigger,
  status: r.status,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  ...(JSON.parse(r.data) as RunData)
})

const toDecision = (r: DecisionRow): Decision => ({
  key: r.key,
  kind: r.kind as DecisionKind,
  until: r.until,
  note: r.note,
  decidedAt: r.decided_at
})

const THRESHOLDS_KEY = 'audit.thresholds'
const AUTO_AUDIT_KEY = 'audit.autoHours'

export class AuditRepo {
  constructor(private readonly db: Db) {}

  saveSnapshot(s: Snapshot): void {
    this.db
      .prepare('INSERT INTO snapshots (server_id, taken_at, data) VALUES (?, ?, ?)')
      .run(s.serverId, s.takenAt, JSON.stringify(s))
  }

  /** Newest first. */
  recentSnapshots(serverId: number, limit: number): Snapshot[] {
    const rows = this.db
      .prepare(
        'SELECT data FROM snapshots WHERE server_id = ? ORDER BY taken_at DESC, id DESC LIMIT ?'
      )
      .all(serverId, limit) as { data: string }[]
    return rows.map((r) => JSON.parse(r.data) as Snapshot)
  }

  createRun(trigger: AuditRun['trigger'], serverId: number): AuditRun {
    const data: RunData = {
      round: 0,
      serverErrors: [],
      analyzerError: null,
      findings: [],
      items: [],
      pendingCommands: []
    }
    const startedAt = new Date().toISOString()
    const result = this.db
      .prepare(
        `INSERT INTO audit_runs (server_id, trigger, status, started_at, data)
         VALUES (?, ?, 'collecting', ?, ?)`
      )
      .run(serverId, trigger, startedAt, JSON.stringify(data))
    return this.getRun(Number(result.lastInsertRowid))
  }

  saveRun(run: AuditRun): void {
    // server_id is fixed at creation; it stays out of the JSON blob.
    const { id, trigger, status, startedAt, finishedAt, ...data } = run
    this.db
      .prepare(
        `UPDATE audit_runs SET trigger=?, status=?, started_at=?, finished_at=?, data=? WHERE id=?`
      )
      .run(
        trigger,
        status,
        startedAt,
        finishedAt,
        JSON.stringify({ ...data, serverId: undefined }),
        id
      )
  }

  getRun(id: number): AuditRun {
    const row = this.db.prepare('SELECT * FROM audit_runs WHERE id = ?').get(id) as
      RunRow | undefined
    if (!row) throw new Error(`Audit run ${id} not found`)
    return toRun(row)
  }

  /** Runs a previous app session left unfinished can never resume; close them as failed. */
  failInterrupted(finishedAt: string): void {
    const rows = this.db
      .prepare(`SELECT * FROM audit_runs WHERE status NOT IN ('done', 'failed')`)
      .all() as RunRow[]
    for (const row of rows) {
      this.saveRun({
        ...toRun(row),
        status: 'failed',
        finishedAt,
        pendingCommands: [],
        analyzerError: 'Прервано: приложение было закрыто'
      })
    }
  }

  latestRun(serverId: number): AuditRun | null {
    const row = this.db
      .prepare('SELECT * FROM audit_runs WHERE server_id = ? ORDER BY id DESC LIMIT 1')
      .get(serverId) as RunRow | undefined
    return row ? toRun(row) : null
  }

  /** The last successful run of this server before `beforeId`: the baseline for new alerts. */
  previousDone(serverId: number, beforeId: number): AuditRun | null {
    const row = this.db
      .prepare(
        `SELECT * FROM audit_runs WHERE server_id = ? AND id < ? AND status = 'done'
         ORDER BY id DESC LIMIT 1`
      )
      .get(serverId, beforeId) as RunRow | undefined
    return row ? toRun(row) : null
  }

  lastFinishedAt(serverId: number): string | null {
    const row = this.db
      .prepare(
        `SELECT finished_at FROM audit_runs WHERE server_id = ? AND status = 'done'
         ORDER BY finished_at DESC LIMIT 1`
      )
      .get(serverId) as { finished_at: string } | undefined
    return row?.finished_at ?? null
  }

  setDecision(key: string, input: DecisionInput): Decision {
    this.db
      .prepare(
        `INSERT INTO decisions (key, kind, until, note, decided_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET kind=excluded.kind, until=excluded.until,
           note=excluded.note, decided_at=excluded.decided_at`
      )
      .run(key, input.kind, input.until, input.note, new Date().toISOString())
    const row = this.db.prepare('SELECT * FROM decisions WHERE key = ?').get(key) as DecisionRow
    return toDecision(row)
  }

  listDecisions(): Decision[] {
    const rows = this.db.prepare('SELECT * FROM decisions ORDER BY decided_at').all()
    return (rows as DecisionRow[]).map(toDecision)
  }

  getThresholds(): Thresholds {
    return { ...DEFAULT_THRESHOLDS, ...this.getSetting<Partial<Thresholds>>(THRESHOLDS_KEY, {}) }
  }

  setThresholds(t: Thresholds): void {
    this.setSetting(THRESHOLDS_KEY, t)
  }

  getAutoAuditHours(): number {
    const hours = this.getSetting(AUTO_AUDIT_KEY, DEFAULT_AUTO_AUDIT_HOURS)
    return AUTO_AUDIT_HOURS.includes(hours) ? hours : DEFAULT_AUTO_AUDIT_HOURS
  }

  setAutoAuditHours(hours: number): void {
    if (!AUTO_AUDIT_HOURS.includes(hours)) throw new Error(`Недопустимый период: ${hours}`)
    this.setSetting(AUTO_AUDIT_KEY, hours)
  }

  private getSetting<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      { value: string } | undefined
    return row ? (JSON.parse(row.value) as T) : fallback
  }

  private setSetting(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value`
      )
      .run(key, JSON.stringify(value))
  }
}
