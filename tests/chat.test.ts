import { chmodSync, mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RawCommandRequest } from '../src/main/audit/allowlist'
import { AuditRepo } from '../src/main/audit/auditRepo'
import {
  CHAT_SCHEMA,
  CHAT_SYSTEM_PROMPT,
  buildChatPrompt,
  runChatClaude,
  type ChatReply
} from '../src/main/audit/chat'
import { ChatRepo } from '../src/main/audit/chatRepo'
import { ChatService, type ChatDeps } from '../src/main/audit/chatService'
import { openDb } from '../src/main/db'
import { Repo } from '../src/main/repo'
import { AUDIT_STOPPED, type FindingChat, type Finding, type Snapshot } from '../src/shared/audit'
import type { ServerInput } from '../src/shared/types'

const FAKE = join(__dirname, 'fixtures/fake-claude.mjs')

const SERVER: ServerInput = {
  name: 'one',
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

const FINDING: Finding = {
  key: 'unknown:1:app',
  serverId: 1,
  severity: 'info',
  title: 'Неизвестный контейнер app',
  explanation: 'Контейнер app не записан в реестр.',
  evidenceRefs: [],
  suggestedQuestion: '',
  suggestedAction: '',
  source: 'rule',
  code: 'unknown',
  registryCandidate: null
}

const snapshot = (serverId: number): Snapshot => ({
  serverId,
  takenAt: '2026-10-17T00:00:00.000Z',
  host: null,
  disks: [],
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
  cron: ['0 3 * * * PGPASSWORD=cronpass pg_dump app'],
  unavailable: []
})

const LOGS: RawCommandRequest = {
  command_id: 'docker_logs',
  server_id: 1,
  args: { container: 'app' },
  reason: 'r'
}

const reply = (text: string, commandRequests: RawCommandRequest[] = []): ChatReply => ({
  sessionId: 'chat-sess',
  output: { reply: text, commandRequests }
})

describe('ChatRepo', () => {
  it('stores chats per server and finding, lists keys, and resets interrupted ones', () => {
    const db = openDb(':memory:')
    const repo = new Repo(db)
    const chats = new ChatRepo(db)
    const { id } = repo.createServer(SERVER)
    expect(chats.get(id, 'k')).toBeNull()
    const chat: FindingChat = {
      serverId: id,
      findingKey: 'k',
      title: 't',
      sessionId: 's',
      messages: [{ role: 'user', text: 'hi', at: '2026-10-17T00:00:00.000Z' }],
      status: 'thinking',
      round: 0,
      pendingCommands: [],
      error: null,
      startedAt: '2026-10-17T00:00:00.000Z'
    }
    chats.save(chat)
    expect(chats.get(id, 'k')).toEqual(chat)
    expect(chats.keys(id)).toEqual(['k'])
    chats.failInterrupted()
    expect(chats.get(id, 'k')).toMatchObject({
      status: 'idle',
      startedAt: null,
      error: 'Прервано: приложение было закрыто'
    })
    repo.removeServer(id)
    expect(chats.keys(id)).toEqual([])
  })
})

describe('chat prompt', () => {
  it('gives the model the finding and a masked snapshot of its server', () => {
    const prompt = buildChatPrompt({
      server: { ...SERVER, id: 1, createdAt: '', updatedAt: '' },
      services: [],
      snapshot: snapshot(1),
      finding: FINDING,
      decisions: [],
      question: 'Как его остановить?'
    })
    expect(prompt).toContain('Неизвестный контейнер app')
    expect(prompt).toContain('"name": "app"')
    expect(prompt).toContain('Как его остановить?')
    expect(prompt).not.toContain('cronpass')
  })

  it('asks the model to give one step at a time and wait for the result', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('ПО ОДНОМУ ШАГУ')
    expect(CHAT_SYSTEM_PROMPT).toContain('дождись')
  })

  it('keeps the model read-only and lets it ask for allowlisted commands', () => {
    expect(CHAT_SCHEMA.required).toEqual(['reply', 'command_requests'])
    expect(CHAT_SYSTEM_PROMPT).toContain('не можешь')
    expect(CHAT_SYSTEM_PROMPT).toContain('docker_logs')
  })
})

describe('runChatClaude', () => {
  let log: string
  beforeEach(() => {
    chmodSync(FAKE, 0o755)
    log = join(mkdtempSync(join(tmpdir(), 'fake-claude-')), 'log.jsonl')
    process.env.FAKE_CLAUDE_LOG = log
    process.env.FAKE_CLAUDE_REPLY = JSON.stringify({
      type: 'result',
      is_error: false,
      session_id: 's1',
      structured_output: { reply: 'Ответ', command_requests: [LOGS] }
    })
  })
  afterEach(() => {
    delete process.env.FAKE_CLAUDE_LOG
    delete process.env.FAKE_CLAUDE_REPLY
  })

  it('uses the chat schema in an isolated session', async () => {
    const result = await runChatClaude({ bin: FAKE, prompt: 'q', resume: 's0' })
    expect(result).toEqual({ sessionId: 's1', output: { reply: 'Ответ', commandRequests: [LOGS] } })
    const { argv } = JSON.parse(readFileSync(log, 'utf8').trim()) as { argv: string[] }
    expect(argv[argv.indexOf('--json-schema') + 1]).toBe(JSON.stringify(CHAT_SCHEMA))
    expect(argv[argv.indexOf('--system-prompt') + 1]).toBe(CHAT_SYSTEM_PROMPT)
    expect(argv[argv.indexOf('--resume') + 1]).toBe('s0')
    expect(argv).toContain('--restricted')
  })
})

interface Harness {
  service: ChatService
  chats: ChatRepo
  prompts: { prompt: string; resume?: string }[]
  execs: string[]
  updates: FindingChat[]
}

function harness(
  claude: ChatDeps['claude'] | null = null,
  autoApprove: boolean | null = true,
  overrides: Partial<ChatDeps> = {}
): Harness {
  const db = openDb(':memory:')
  const repo = new Repo(db)
  const audit = new AuditRepo(db)
  const chats = new ChatRepo(db)
  const { id } = repo.createServer(SERVER)
  audit.saveSnapshot(snapshot(id))
  const run = audit.createRun('manual', id)
  audit.saveRun({ ...run, status: 'done', findings: [FINDING] })
  const h = { chats, prompts: [], execs: [], updates: [] } as unknown as Harness
  h.service = new ChatService({
    repo,
    audit,
    chats,
    exec: async (_server, command) => {
      h.execs.push(command)
      return { stdout: 'started DB_PASSWORD=hunter2', stderr: '', code: 0 }
    },
    claude:
      claude ??
      (async (prompt, resume) => {
        h.prompts.push({ prompt, resume })
        return reply('Это контейнер блога.')
      }),
    emit: (chat) => {
      h.updates.push(chat)
      if (chat.status === 'awaiting_confirmation' && autoApprove !== null) {
        const ids = autoApprove ? chat.pendingCommands.map((c) => c.id) : []
        queueMicrotask(() => h.service.answerCommands(chat.serverId, chat.findingKey, ids))
      }
    },
    now: () => new Date('2026-10-17T00:00:00Z'),
    ...overrides
  })
  return h
}

describe('ChatService', () => {
  it('answers the first question with full context and later ones in the same session', async () => {
    const h = harness()
    h.service.send(1, FINDING.key, 'Что это?')
    await h.service.done()
    h.service.send(1, FINDING.key, 'Как остановить?')
    await h.service.done()

    expect(h.prompts[0].resume).toBeUndefined()
    expect(h.prompts[0].prompt).toContain('Неизвестный контейнер app')
    expect(h.prompts[1]).toEqual({ prompt: 'Как остановить?', resume: 'chat-sess' })
    const chat = h.chats.get(1, FINDING.key)!
    expect(chat).toMatchObject({ status: 'idle', sessionId: 'chat-sess', error: null })
    expect(chat.messages.map((m) => [m.role, m.text])).toEqual([
      ['user', 'Что это?'],
      ['assistant', 'Это контейнер блога.'],
      ['user', 'Как остановить?'],
      ['assistant', 'Это контейнер блога.']
    ])
  })

  it('runs confirmed read-only commands and feeds masked output back', async () => {
    const h = harness(async (prompt, resume) => {
      h.prompts.push({ prompt, resume })
      return h.prompts.length === 1 ? reply('Посмотрю логи.', [LOGS]) : reply('Логи чистые.')
    })
    h.service.send(1, FINDING.key, 'Он падает?')
    await h.service.done()
    expect(h.execs).toEqual(["docker logs --tail 100 'app'"])
    expect(h.prompts[1].resume).toBe('chat-sess')
    expect(h.prompts[1].prompt).toContain('started')
    expect(h.prompts[1].prompt).not.toContain('hunter2')
    expect(h.updates.some((c) => c.status === 'awaiting_confirmation')).toBe(true)
    const chat = h.chats.get(1, FINDING.key)!
    expect(chat.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'commands', 'assistant'])
    expect(chat.messages[2].commands).toEqual([
      { command: "docker logs --tail 100 'app'", status: 'ran' }
    ])
  })

  it('does not run declined commands', async () => {
    const h = harness(async (prompt, resume) => {
      h.prompts.push({ prompt, resume })
      return h.prompts.length === 1 ? reply('', [LOGS]) : reply('Ок.')
    }, false)
    h.service.send(1, FINDING.key, '?')
    await h.service.done()
    expect(h.execs).toEqual([])
    expect(h.prompts[1].prompt).toContain('declined')
    expect(h.chats.get(1, FINDING.key)!.messages[1].commands).toEqual([
      { command: "docker logs --tail 100 'app'", status: 'declined' }
    ])
  })

  it('refuses a second question while Claude is answering', async () => {
    const h = harness()
    h.service.send(1, FINDING.key, 'a')
    expect(() => h.service.send(1, FINDING.key, 'b')).toThrow('Claude ещё отвечает')
    await h.service.done()
  })

  it('stops a pending answer and kills the CLI call', async () => {
    let signal: AbortSignal | undefined
    const h = harness((_p, _r, s) => {
      signal = s
      return new Promise(() => {})
    })
    h.service.send(1, FINDING.key, 'a')
    h.service.stop(1, FINDING.key)
    await h.service.done()
    expect(signal?.aborted).toBe(true)
    expect(h.chats.get(1, FINDING.key)).toMatchObject({ status: 'idle', error: AUDIT_STOPPED })
  })

  it('keeps the chat usable after a Claude error', async () => {
    const h = harness(async () => {
      throw new Error('Not logged in')
    })
    h.service.send(1, FINDING.key, 'a')
    await h.service.done()
    expect(h.chats.get(1, FINDING.key)).toMatchObject({ status: 'idle', error: 'Not logged in' })
  })

  it('refuses to open a chat for a finding that is not in the latest audit', () => {
    const h = harness()
    expect(() => h.service.send(1, 'nope', 'a')).toThrow('Проблема не найдена')
  })
})
