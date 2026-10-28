import {
  AUDIT_STOPPED,
  isDecided,
  type AuditRun,
  type CommandRequest,
  type Decision,
  type DecisionInput,
  type Finding,
  type Snapshot
} from '../../shared/audit'
import type { Server } from '../../shared/types'
import type { Repo } from '../repo'
import type { ExecResult } from '../sshConnect'
import { executeRequest, validateRequest } from './allowlist'
import { buildAnalysisPrompt, buildFollowUpPrompt, type ClaudeResult } from './analyzer'
import type { AuditRepo } from './auditRepo'
import {
  ANSWER_TIMEOUT_MS,
  Stopped,
  abortable,
  errorMessage,
  waitForAnswer,
  type Controlled
} from './control'
import { runRules } from './rules'

export const MAX_COMMAND_ROUNDS = 3
const SNAPSHOT_HISTORY = 7
export interface AuditDeps {
  repo: Repo
  audit: AuditRepo
  collect(server: Server): Promise<Snapshot>
  exec(server: Server, command: string): Promise<ExecResult>
  claude(prompt: string, resume?: string, signal?: AbortSignal): Promise<ClaudeResult>
  emit(run: AuditRun): void
  now(): Date
  answerTimeoutMs?: number
}

interface ActiveRun extends Controlled {
  runId: number
  promise: Promise<void>
}

/** Findings worth a notification: warning or worse, new since `prev`, and not decided. */
export function newAlertFindings(
  prev: AuditRun | null,
  run: AuditRun,
  decisions: Decision[],
  now: Date
): Finding[] {
  const seen = new Set(prev?.findings.map((f) => f.key) ?? [])
  const byKey = new Map(decisions.map((d) => [d.key, d]))
  return run.findings.filter(
    (f) => f.severity !== 'info' && !seen.has(f.key) && !isDecided(byKey.get(f.key), now)
  )
}

export class AuditService {
  /** Keyed by server id: each server has at most one run in progress. */
  private readonly active = new Map<number, ActiveRun>()

  constructor(private readonly deps: AuditDeps) {}

  isRunning(serverId?: number): boolean {
    return serverId === undefined ? this.active.size > 0 : this.active.has(serverId)
  }

  start(trigger: AuditRun['trigger'], serverId: number): AuditRun {
    if (this.active.has(serverId)) throw new Error('Проверка этого сервера уже идёт')
    const server = this.deps.repo.listServers().find((s) => s.id === serverId)
    if (!server) throw new Error(`Сервер ${serverId} не найден`)
    const run = this.deps.audit.createRun(trigger, serverId)
    const entry: ActiveRun = {
      runId: run.id,
      controller: new AbortController(),
      promise: Promise.resolve(),
      answer: null
    }
    this.active.set(serverId, entry)
    entry.promise = this.execute(run, server, entry).finally(() => this.active.delete(serverId))
    return run
  }

  /** Aborts the server's run: the CLI is killed, pending commands are declined. */
  stop(serverId: number): void {
    this.active.get(serverId)?.controller.abort()
  }

  /** Resolves when every run in progress has finished. */
  async done(): Promise<void> {
    await Promise.all([...this.active.values()].map((a) => a.promise))
  }

  answerCommands(runId: number, approvedIds: string[]): void {
    const entry = [...this.active.values()].find((a) => a.runId === runId)
    entry?.answer?.(approvedIds)
  }

  decide(key: string, input: DecisionInput): Decision {
    const decision = this.deps.audit.setDecision(key, input)
    if (input.kind === 'keep') {
      const candidate = this.deps.repo
        .listServers()
        .flatMap((s) => this.deps.audit.latestRun(s.id)?.findings ?? [])
        .find((f) => f.key === key)?.registryCandidate
      const exists =
        candidate &&
        this.deps.repo
          .listServices(candidate.serverId)
          .some((s) => s.name.toLowerCase() === candidate.name.toLowerCase())
      if (candidate && !exists) {
        this.deps.repo.createService({
          serverId: candidate.serverId,
          name: candidate.name,
          kind: candidate.kind,
          url: '',
          port: null,
          description: 'Добавлено из аудита',
          enpassItemUuid: '',
          expected: true,
          notes: ''
        })
      }
    }
    return decision
  }

  private save(run: AuditRun): void {
    this.deps.audit.saveRun(run)
    this.deps.emit(structuredClone(run))
  }

  private async execute(run: AuditRun, server: Server, entry: ActiveRun): Promise<void> {
    const signal = entry.controller.signal
    try {
      this.save(run)
      let snapshot: Snapshot
      try {
        snapshot = await abortable(this.deps.collect(server), signal)
      } catch (err) {
        if (err instanceof Stopped) throw err
        run.serverErrors = [{ serverId: server.id, message: errorMessage(err) }]
        run.status = 'failed'
        run.finishedAt = this.deps.now().toISOString()
        this.save(run)
        return
      }
      this.deps.audit.saveSnapshot(snapshot)

      const history = this.deps.audit.recentSnapshots(server.id, SNAPSHOT_HISTORY)
      const signals = runRules({
        servers: [server],
        services: this.deps.repo.listServices(server.id),
        snapshots: new Map([[server.id, history]]),
        thresholds: this.deps.audit.getThresholds(),
        now: this.deps.now()
      })
      run.findings = signals
      run.status = 'analyzing'
      this.save(run)

      await this.analyze(run, server, history, signals, entry)
      run.status = 'done'
    } catch (err) {
      run.status = 'failed'
      run.analyzerError = err instanceof Stopped ? AUDIT_STOPPED : errorMessage(err)
      run.pendingCommands = []
    }
    run.finishedAt = this.deps.now().toISOString()
    this.save(run)
  }

  private async analyze(
    run: AuditRun,
    server: Server,
    history: Snapshot[],
    signals: Finding[],
    entry: ActiveRun
  ): Promise<void> {
    const signal = entry.controller.signal
    // Applied and shown after every successful call, so a failed follow-up keeps the earlier
    // analysis and the user sees results while later rounds run.
    const apply = (output: ClaudeResult['output']): void => {
      const llmKeys = new Set(output.findings.map((f) => f.key))
      run.findings = [...signals.filter((f) => !llmKeys.has(f.key)), ...output.findings]
      run.items = output.items
      this.save(run)
    }
    const claude = (prompt: string, resume?: string): Promise<ClaudeResult> =>
      abortable(this.deps.claude(prompt, resume, signal), signal)

    try {
      let result = await claude(
        buildAnalysisPrompt({
          servers: [server],
          services: this.deps.repo.listServices(server.id),
          snapshots: history.slice(0, 1),
          previous: history.slice(1, 2),
          signals,
          decisions: this.deps.audit.listDecisions(),
          finalRound: false
        })
      )
      apply(result.output)

      while (result.output.commandRequests.length > 0 && run.round < MAX_COMMAND_ROUNDS) {
        const requests = result.output.commandRequests.map((raw) =>
          validateRequest(raw, raw.server_id === server.id ? history[0] : null)
        )
        run.pendingCommands = requests
        run.status = 'awaiting_confirmation'
        this.save(run)
        const approved = new Set(
          await waitForAnswer(entry, this.deps.answerTimeoutMs ?? ANSWER_TIMEOUT_MS)
        )
        run.pendingCommands = []
        run.status = 'analyzing'
        this.save(run)

        const results: { request: CommandRequest; declined: boolean; output: string | null }[] = []
        for (const request of requests) {
          const runIt = request.command !== null && approved.has(request.id)
          results.push({
            request,
            declined: !request.error && !approved.has(request.id),
            output: runIt
              ? await abortable(
                  executeRequest(request, (command) => this.deps.exec(server, command)),
                  signal
                )
              : null
          })
        }
        run.round++
        result = await claude(
          buildFollowUpPrompt(results, run.round >= MAX_COMMAND_ROUNDS),
          result.sessionId
        )
        apply(result.output)
      }
    } catch (err) {
      if (err instanceof Stopped) throw err
      run.analyzerError = errorMessage(err)
      run.pendingCommands = []
    }
  }
}
