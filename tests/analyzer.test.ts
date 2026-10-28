import { chmodSync, mkdtempSync, readFileSync, realpathSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  ANALYSIS_SCHEMA,
  FINAL_ROUND_NOTE,
  SYSTEM_PROMPT,
  buildAnalysisPrompt,
  buildFollowUpPrompt,
  resolveClaudeBin,
  runClaude,
  snapshotChanges
} from '../src/main/audit/analyzer'
import type { ContainerInfo, Snapshot } from '../src/shared/audit'

const FAKE = join(__dirname, 'fixtures/fake-claude.mjs')

const REPLY = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  session_id: 'sess-1',
  result: '',
  structured_output: {
    items: [
      { server_id: 1, ref: 'app', what_it_is: 'Блог', project_guess: 'blog', confidence: 0.8 }
    ],
    findings: [
      {
        key: 'stale:1:app',
        server_id: 1,
        severity: 'warning',
        title: 'Старый блог',
        explanation: 'e',
        evidence_refs: ['app'],
        suggested_question: 'q',
        suggested_action: 'a'
      }
    ],
    command_requests: [
      { command_id: 'docker_logs', server_id: 1, args: { container: 'app', n: 50 }, reason: 'why' }
    ]
  }
}

let log: string
const ENV_KEYS = [
  'FAKE_CLAUDE_LOG',
  'FAKE_CLAUDE_REPLY',
  'FAKE_CLAUDE_EXIT',
  'FAKE_CLAUDE_DELAY_MS'
] as const

beforeAll(() => chmodSync(FAKE, 0o755))

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
})

function fake(reply: unknown = REPLY): void {
  log = join(mkdtempSync(join(tmpdir(), 'fake-claude-')), 'log.jsonl')
  process.env.FAKE_CLAUDE_LOG = log
  process.env.FAKE_CLAUDE_REPLY = JSON.stringify(reply)
}

const calls = (): { argv: string[]; stdin: string; cwd: string }[] =>
  readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))

describe('runClaude', () => {
  it('passes the prompt on stdin with structured-output flags and no tools', async () => {
    fake()
    await runClaude({ bin: FAKE, prompt: 'hello' })
    const [{ argv, stdin }] = calls()
    expect(stdin).toBe('hello')
    expect(argv.slice(0, 3)).toEqual(['-p', '--output-format', 'json'])
    const tools = argv.indexOf('--tools')
    expect(argv[tools + 1]).toBe('')
    expect(argv).toContain('--json-schema')
    expect(argv).toContain('--system-prompt')
    expect(argv).not.toContain('--bare')
    expect(argv).not.toContain('--resume')
  })

  it('isolates the session from MCP servers, hooks, skills and user settings', async () => {
    fake()
    await runClaude({ bin: FAKE, prompt: 'x' })
    const { argv } = calls()[0]
    expect(argv).toContain('--restricted')
    expect(argv).toContain('--strict-mcp-config')
    expect(argv).toContain('--disable-slash-commands')
    expect(argv[argv.indexOf('--disallowedTools') + 1]).toBe('mcp__*')
    expect(argv).not.toContain('--mcp-config')
  })

  it('runs in the given working directory, creating it if needed', async () => {
    fake()
    const cwd = join(mkdtempSync(join(tmpdir(), 'claude-cwd-')), 'sessions')
    await runClaude({ bin: FAKE, prompt: 'x', cwd })
    expect(calls()[0].cwd).toBe(realpathSync(cwd))
  })

  it('resumes a session', async () => {
    fake()
    await runClaude({ bin: FAKE, prompt: 'more', resume: 's1' })
    const { argv } = calls()[0]
    expect(argv[argv.indexOf('--resume') + 1]).toBe('s1')
  })

  it('maps structured output to camelCase with llm-prefixed keys', async () => {
    fake()
    const result = await runClaude({ bin: FAKE, prompt: 'x' })
    expect(result.sessionId).toBe('sess-1')
    expect(result.output.findings[0]).toEqual({
      key: 'llm:stale:1:app',
      serverId: 1,
      severity: 'warning',
      title: 'Старый блог',
      explanation: 'e',
      evidenceRefs: ['app'],
      suggestedQuestion: 'q',
      suggestedAction: 'a',
      source: 'llm',
      code: null,
      registryCandidate: null
    })
    expect(result.output.items[0]).toEqual({
      serverId: 1,
      ref: 'app',
      whatItIs: 'Блог',
      projectGuess: 'blog',
      confidence: 0.8
    })
    expect(result.output.commandRequests[0]).toEqual(REPLY.structured_output.command_requests[0])
  })

  it('kills the CLI when the signal aborts', async () => {
    fake()
    process.env.FAKE_CLAUDE_DELAY_MS = '10000'
    const controller = new AbortController()
    const started = Date.now()
    const pending = runClaude({ bin: FAKE, prompt: 'x', signal: controller.signal })
    setTimeout(() => controller.abort(), 50)
    await expect(pending).rejects.toThrow()
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('does not ask the model about consolidation', () => {
    expect(ANALYSIS_SCHEMA.required).not.toContain('consolidation')
    expect(SYSTEM_PROMPT).not.toContain('consolidation')
  })

  it('rejects with stderr on a non-zero exit', async () => {
    fake()
    process.env.FAKE_CLAUDE_EXIT = '2'
    await expect(runClaude({ bin: FAKE, prompt: 'x' })).rejects.toThrow(/boom/)
  })

  it('rejects when there is no structured output', async () => {
    fake({ ...REPLY, structured_output: undefined })
    await expect(runClaude({ bin: FAKE, prompt: 'x' })).rejects.toThrow()
    fake({ ...REPLY, is_error: true, result: 'Not logged in' })
    await expect(runClaude({ bin: FAKE, prompt: 'x' })).rejects.toThrow(/Not logged in/)
  })
})

describe('resolveClaudeBin', () => {
  it('prefers KENNEL_CLAUDE_BIN', async () => {
    await expect(resolveClaudeBin({ KENNEL_CLAUDE_BIN: FAKE })).resolves.toBe(FAKE)
  })

  it('fails with a clear message when nothing is found', async () => {
    const home = mkdtempSync(join(tmpdir(), 'home-'))
    await expect(
      resolveClaudeBin({ KENNEL_CLAUDE_BIN: '/nope', HOME: home, SHELL: '/bin/false' })
    ).rejects.toThrow(/Claude CLI not found/)
  })
})

const container = (name: string, labels: Record<string, string> = {}): ContainerInfo => ({
  id: name,
  name,
  image: `${name}:1`,
  imageId: '',
  imageCreatedAt: null,
  state: 'running',
  startedAt: null,
  restartCount: 0,
  ports: [],
  labels
})

const snap = (containers: ContainerInfo[], units: string[] = []): Snapshot => ({
  serverId: 1,
  takenAt: '2026-10-17T00:00:00.000Z',
  host: null,
  disks: [],
  containers,
  units: units.map((name) => ({ name, active: 'active', sub: 'running', custom: true })),
  ports: [],
  vhosts: [],
  certs: [],
  cron: [],
  unavailable: []
})

describe('prompts', () => {
  const input = {
    servers: [],
    services: [],
    snapshots: [
      snap([
        container('app', {
          'traefik.http.routers.app.rule': 'Host(`app.example.com`)',
          'org.opencontainers.image.description': 'SECRETLABEL'
        })
      ])
    ],
    previous: [],
    signals: [],
    decisions: []
  }

  it('keeps only whitelisted labels', () => {
    const prompt = buildAnalysisPrompt({ ...input, finalRound: false })
    expect(prompt).toContain('app.example.com')
    expect(prompt).not.toContain('SECRETLABEL')
    expect(prompt).not.toContain(FINAL_ROUND_NOTE)
  })

  it('tells the model when no more commands are allowed', () => {
    expect(buildAnalysisPrompt({ ...input, finalRound: true })).toContain(FINAL_ROUND_NOTE)
    expect(buildFollowUpPrompt([], true)).toContain(FINAL_ROUND_NOTE)
  })

  it('reports declined commands in the follow-up', () => {
    const request = {
      id: 'r1',
      serverId: 1,
      commandId: 'docker_logs',
      args: { container: 'app' },
      reason: '',
      command: "docker logs --tail 100 'app'",
      error: null
    }
    const text = buildFollowUpPrompt([{ request, output: null, declined: true }], false)
    expect(text).toContain('declined')
    expect(buildFollowUpPrompt([{ request, output: 'LOGLINE', declined: false }], false)).toContain(
      'LOGLINE'
    )
  })
})

describe('snapshotChanges', () => {
  it('lists added and removed containers and units', () => {
    const prev = snap([container('a'), container('b')], ['x.service'])
    const cur = snap([container('b'), container('c')], ['y.service'])
    expect(snapshotChanges(prev, cur)).toEqual({
      addedContainers: ['c'],
      removedContainers: ['a'],
      addedUnits: ['y.service'],
      removedUnits: ['x.service']
    })
    expect(snapshotChanges(null, cur)).toEqual({
      addedContainers: [],
      removedContainers: [],
      addedUnits: [],
      removedUnits: []
    })
  })
})

describe('buildAnalysisPrompt secret masking', () => {
  it('masks secrets in cron lines and label values', () => {
    const s = {
      ...snap([
        container('app', {
          'traefik.http.middlewares.auth.basicauth.users': 'admin:$apr1$salt$labelhash'
        })
      ]),
      cron: ['0 3 * * * PGPASSWORD=cronpass pg_dump app > /b.sql']
    }
    const prompt = buildAnalysisPrompt({
      servers: [],
      services: [],
      snapshots: [s],
      previous: [s],
      signals: [],
      decisions: [],
      finalRound: false
    })
    expect(prompt).toContain('pg_dump')
    expect(prompt).not.toContain('cronpass')
    expect(prompt).not.toContain('labelhash')
  })
})
