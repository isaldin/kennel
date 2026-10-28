import { beforeEach, describe, expect, it } from 'vitest'
import { FINAL_ROUND_NOTE, type ClaudeResult } from '../src/main/audit/analyzer'
import type { RawCommandRequest } from '../src/main/audit/allowlist'
import { AuditRepo } from '../src/main/audit/auditRepo'
import {
  AuditService,
  MAX_COMMAND_ROUNDS,
  newAlertFindings,
  type AuditDeps
} from '../src/main/audit/auditService'
import { openDb } from '../src/main/db'
import { Repo } from '../src/main/repo'
import type { AuditRun, Decision, Finding, Snapshot } from '../src/shared/audit'
import type { Server, ServerInput } from '../src/shared/types'

const NOW = new Date('2026-10-17T00:00:00Z')

const input = (name: string): ServerInput => ({
  name,
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
})

const snapshotFor = (server: Server): Snapshot => ({
  serverId: server.id,
  takenAt: new Date().toISOString(),
  host: null,
  disks: [{ mount: '/', fs: 'ext4', size: 100, used: 95 }],
  containers: [
    {
      id: 'app',
      name: 'app',
      image: 'app:1',
      imageId: '',
      imageCreatedAt: null,
      state: 'running',
      startedAt: null,
      restartCount: 0,
      ports: [],
      labels: {}
    }
  ],
  units: [],
  ports: [],
  vhosts: [],
  certs: [],
  cron: [],
  unavailable: []
})

const reply = (
  commandRequests: RawCommandRequest[] = [],
  findings: Finding[] = []
): ClaudeResult => ({
  sessionId: 'sess',
  output: { items: [], findings, commandRequests }
})

const LOGS_REQUEST: RawCommandRequest = {
  command_id: 'docker_logs',
  server_id: 1,
  args: { container: 'app' },
  reason: 'r'
}

interface Harness {
  service: AuditService
  repo: Repo
  audit: AuditRepo
  prompts: { prompt: string; resume?: string }[]
  execs: string[]
  runs: AuditRun[]
  deps: AuditDeps
}

function harness(overrides: Partial<AuditDeps> = {}, autoApprove: boolean | null = true): Harness {
  const db = openDb(':memory:')
  const repo = new Repo(db)
  const audit = new AuditRepo(db)
  repo.createServer(input('one'))
  repo.createServer(input('two'))
  const h = { repo, audit, prompts: [], execs: [], runs: [] } as unknown as Harness
  h.deps = {
    repo,
    audit,
    collect: async (server) => snapshotFor(server),
    exec: async (_server, command) => {
      h.execs.push(command)
      return { stdout: 'LOG DB_PASSWORD=hunter2', stderr: '', code: 0 }
    },
    claude: async (prompt, resume) => {
      h.prompts.push({ prompt, resume })
      return reply()
    },
    emit: (run) => {
      h.runs.push(run)
      if (run.status === 'awaiting_confirmation' && autoApprove !== null) {
        const ids = autoApprove ? run.pendingCommands.map((c) => c.id) : []
        queueMicrotask(() => h.service.answerCommands(run.id, ids))
      }
    },
    now: () => NOW,
    ...overrides
  }
  h.service = new AuditService(h.deps)
  return h
}

describe('AuditService', () => {
  let h: Harness

  beforeEach(() => {
    h = harness()
  })

  it('audits only the given server', async () => {
    h.service.start('manual', 2)
    await h.service.done()
    expect(h.audit.latestRun(2)).toMatchObject({ serverId: 2, status: 'done' })
    expect(h.audit.latestRun(1)).toBeNull()
    expect(h.prompts[0].prompt).toContain('"serverId": 2')
    expect(h.prompts[0].prompt).not.toContain('"serverId": 1')
    expect(h.prompts[0].prompt).not.toContain('"name": "one"')
  })

  it('fails the run when the server cannot be reached, without calling Claude', async () => {
    h = harness({
      collect: async () => {
        throw new Error('connect ECONNREFUSED')
      }
    })
    h.service.start('manual', 1)
    await h.service.done()
    const run = h.audit.latestRun(1)!
    expect(run.status).toBe('failed')
    expect(run.serverErrors).toEqual([{ serverId: 1, message: 'connect ECONNREFUSED' }])
    expect(h.prompts).toEqual([])
  })

  it('keeps rule findings when the analyzer fails', async () => {
    h = harness({
      claude: async () => {
        throw new Error('Claude CLI не найден')
      }
    })
    h.service.start('manual', 1)
    await h.service.done()
    const run = h.audit.latestRun(1)!
    expect(run.status).toBe('done')
    expect(run.analyzerError).toBe('Claude CLI не найден')
    expect(run.findings.filter((f) => f.code === 'disk_full')).toHaveLength(1)
  })

  it('merges LLM findings and items', async () => {
    const llm: Finding = {
      key: 'llm:x:1:app',
      serverId: 1,
      severity: 'warning',
      title: 't',
      explanation: '',
      evidenceRefs: [],
      suggestedQuestion: '',
      suggestedAction: '',
      source: 'llm',
      code: null,
      registryCandidate: null
    }
    h = harness({ claude: async () => reply([], [llm]) })
    h.service.start('manual', 1)
    await h.service.done()
    expect(h.audit.latestRun(1)!.findings).toContainEqual(llm)
  })

  it(`runs at most ${MAX_COMMAND_ROUNDS} confirmed command rounds`, async () => {
    h = harness({
      claude: async (prompt, resume) => {
        h.prompts.push({ prompt, resume })
        return reply([LOGS_REQUEST])
      }
    })
    h.service.start('manual', 1)
    await h.service.done()
    expect(h.execs).toEqual(Array(MAX_COMMAND_ROUNDS).fill("docker logs --tail 100 'app'"))
    expect(h.prompts).toHaveLength(MAX_COMMAND_ROUNDS + 1)
    expect(h.prompts[1].resume).toBe('sess')
    expect(h.prompts[1].prompt).not.toContain('hunter2')
    expect(h.prompts.at(-1)!.prompt).toContain(FINAL_ROUND_NOTE)
    expect(h.prompts[1].prompt).not.toContain(FINAL_ROUND_NOTE)
    const run = h.audit.latestRun(1)!
    expect(run).toMatchObject({ status: 'done', round: MAX_COMMAND_ROUNDS, pendingCommands: [] })
    expect(h.runs.some((r) => r.status === 'awaiting_confirmation')).toBe(true)
  })

  it('does not run declined commands', async () => {
    let calls = 0
    h = harness(
      {
        claude: async (prompt) => {
          h.prompts.push({ prompt })
          return reply(calls++ === 0 ? [LOGS_REQUEST] : [])
        }
      },
      false
    )
    h.service.start('manual', 1)
    await h.service.done()
    expect(h.execs).toEqual([])
    expect(h.prompts[1].prompt).toContain('declined')
  })

  it('never runs a request the allowlist rejected, even if approved', async () => {
    let calls = 0
    h = harness({
      claude: async (prompt) => {
        h.prompts.push({ prompt })
        return reply(calls++ === 0 ? [{ ...LOGS_REQUEST, args: { container: 'app; reboot' } }] : [])
      }
    })
    h.service.start('manual', 1)
    await h.service.done()
    expect(h.execs).toEqual([])
    expect(h.prompts[1].prompt).toContain('Отклонено allowlist')
  })

  it('runs one audit per server at a time', async () => {
    h.service.start('manual', 1)
    expect(h.service.isRunning(1)).toBe(true)
    expect(h.service.isRunning(2)).toBe(false)
    expect(() => h.service.start('manual', 1)).toThrow('Проверка этого сервера уже идёт')
    h.service.start('manual', 2)
    expect(h.service.isRunning()).toBe(true)
    await h.service.done()
    expect(h.service.isRunning()).toBe(false)
    expect(h.audit.latestRun(2)!.status).toBe('done')
  })

  it('shows the first analysis before asking for commands', async () => {
    const llm: Finding = {
      key: 'llm:x:1:app',
      serverId: 1,
      severity: 'warning',
      title: 't',
      explanation: '',
      evidenceRefs: [],
      suggestedQuestion: '',
      suggestedAction: '',
      source: 'llm',
      code: null,
      registryCandidate: null
    }
    h = harness({ claude: async (_p, resume) => (resume ? reply() : reply([LOGS_REQUEST], [llm])) })
    h.service.start('manual', 1)
    await h.service.done()
    const asking = h.runs.find((r) => r.status === 'awaiting_confirmation')!
    expect(asking.findings).toContainEqual(llm)
  })

  it('adds a kept unknown item to the service registry', async () => {
    h.service.start('manual', 1)
    await h.service.done()
    const key = 'unknown:1:app'
    expect(h.audit.latestRun(1)!.findings.some((f) => f.key === key)).toBe(true)
    h.service.decide(key, { kind: 'keep', until: null, note: '' })
    h.service.decide(key, { kind: 'keep', until: null, note: '' })
    const services = h.repo.listServices(1)
    expect(services).toHaveLength(1)
    expect(services[0]).toMatchObject({ name: 'app', kind: 'docker', expected: true })
  })
})

describe('newAlertFindings', () => {
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
  const run = (findings: Finding[]): AuditRun => ({
    id: 1,
    serverId: 1,
    trigger: 'scheduled',
    status: 'done',
    startedAt: '',
    finishedAt: '',
    round: 0,
    serverErrors: [],
    analyzerError: null,
    findings,
    items: [],
    pendingCommands: []
  })
  const decision = (
    key: string,
    kind: Decision['kind'],
    until: string | null = null
  ): Decision => ({
    key,
    kind,
    until,
    note: '',
    decidedAt: ''
  })

  it('returns new warning+ findings that are not decided', () => {
    const prev = run([finding('old', 'critical')])
    const cur = run([
      finding('old', 'critical'),
      finding('new', 'warning'),
      finding('info', 'info'),
      finding('snoozed', 'critical'),
      finding('expired', 'critical'),
      finding('kept', 'critical')
    ])
    const decisions = [
      decision('snoozed', 'ignore_until', '2026-11-01'),
      decision('expired', 'ignore_until', '2026-10-01'),
      decision('kept', 'keep')
    ]
    expect(newAlertFindings(prev, cur, decisions, NOW).map((f) => f.key)).toEqual([
      'new',
      'expired'
    ])
    expect(newAlertFindings(null, cur, [], NOW).map((f) => f.key)).toContain('old')
  })
})

describe('AuditService resilience', () => {
  const llm: Finding = {
    key: 'llm:x:1:app',
    serverId: 1,
    severity: 'warning',
    title: 't',
    explanation: '',
    evidenceRefs: [],
    suggestedQuestion: '',
    suggestedAction: '',
    source: 'llm',
    code: null,
    registryCandidate: null
  }

  it('keeps the last successful analysis when a follow-up call fails', async () => {
    const h = harness({
      claude: async (_prompt, resume) => {
        if (resume) throw new Error('No conversation found')
        return reply([LOGS_REQUEST], [llm])
      }
    })
    h.service.start('manual', 1)
    await h.service.done()
    const run = h.audit.latestRun(1)!
    expect(run.status).toBe('done')
    expect(run.analyzerError).toBe('No conversation found')
    expect(run.findings).toContainEqual(llm)
    expect(run.findings.some((f) => f.code === 'disk_full')).toBe(true)
  })

  it('declines pending commands when nobody answers in time', async () => {
    const h = harness(
      {
        answerTimeoutMs: 20,
        claude: async (prompt, resume) => {
          h.prompts.push({ prompt, resume })
          return resume ? reply() : reply([LOGS_REQUEST])
        }
      },
      null
    )
    h.service.start('scheduled', 1)
    await h.service.done()
    expect(h.execs).toEqual([])
    expect(h.prompts[1].prompt).toContain('declined')
    expect(h.audit.latestRun(1)).toMatchObject({ status: 'done', pendingCommands: [] })
    expect(h.service.isRunning()).toBe(false)
  })
})

describe('AuditService.stop', () => {
  const STOPPED = 'Остановлено пользователем'
  const never = <T>(): Promise<T> => new Promise<T>(() => {})

  it('stops a run stuck in collection', async () => {
    const h = harness({ collect: () => never() })
    h.service.start('manual', 1)
    h.service.stop(1)
    await h.service.done()
    expect(h.audit.latestRun(1)).toMatchObject({ status: 'failed', analyzerError: STOPPED })
    expect(h.service.isRunning(1)).toBe(false)
  })

  it('stops a run waiting for Claude and aborts the CLI call', async () => {
    let signal: AbortSignal | undefined
    const h = harness({
      claude: (_prompt, _resume, s) => {
        signal = s
        return never()
      }
    })
    h.service.start('manual', 1)
    await new Promise((r) => setTimeout(r, 10))
    h.service.stop(1)
    await h.service.done()
    expect(signal?.aborted).toBe(true)
    expect(h.audit.latestRun(1)).toMatchObject({ status: 'failed', analyzerError: STOPPED })
    expect(h.audit.latestRun(1)!.findings.some((f) => f.code === 'disk_full')).toBe(true)
  })

  it('stops a run waiting for command confirmation', async () => {
    const h = harness({ claude: async () => reply([LOGS_REQUEST]) }, null)
    h.service.start('manual', 1)
    await new Promise((r) => setTimeout(r, 10))
    expect(h.audit.latestRun(1)!.status).toBe('awaiting_confirmation')
    h.service.stop(1)
    await h.service.done()
    expect(h.execs).toEqual([])
    expect(h.audit.latestRun(1)).toMatchObject({
      status: 'failed',
      analyzerError: STOPPED,
      pendingCommands: []
    })
  })

  it('ignores stop when nothing runs', () => {
    const h = harness()
    expect(() => h.service.stop(1)).not.toThrow()
  })
})
