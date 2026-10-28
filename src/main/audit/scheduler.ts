export interface SchedulerDeps {
  serverIds(): number[]
  /** Start time of the server's latest run of any outcome, or null if it was never audited. */
  lastRunAt(serverId: number): string | null
  isRunning(): boolean
  start(serverId: number): void
  now?: () => Date
  checkEveryMs?: number
  /** Re-audit period; null turns automatic audits off. Read on every tick. */
  periodMs?: () => number | null
}

const DAY_MS = 24 * 3_600_000

/**
 * Re-audits each server once per period (a day by default) while the app is open, one server at a time. A server is
 * never audited automatically before its first manual audit, so the app doesn't SSH into every
 * server right after an import.
 */
export class AuditScheduler {
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly deps: SchedulerDeps) {}

  tick(): void {
    if (this.deps.isRunning()) return
    const period = this.deps.periodMs ? this.deps.periodMs() : DAY_MS
    if (period === null) return
    const now = (this.deps.now ?? (() => new Date()))().getTime()
    const due = this.deps.serverIds().find((id) => {
      const last = this.deps.lastRunAt(id)
      return last !== null && now - Date.parse(last) >= period
    })
    if (due !== undefined) this.deps.start(due)
  }

  startTimer(): void {
    this.tick()
    this.timer = setInterval(() => this.tick(), this.deps.checkEveryMs ?? 10 * 60_000)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
