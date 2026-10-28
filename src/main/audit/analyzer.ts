import { execFile, spawn } from 'child_process'
import { constants } from 'fs'
import { access, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type {
  AnalyzedItem,
  CommandId,
  CommandRequest,
  Decision,
  Finding,
  Severity,
  Snapshot
} from '../../shared/audit'
import type { Lang } from '../../shared/i18n'
import type { Server, Service } from '../../shared/types'
import { getLang, t } from '../i18n'
import { maskSecrets, type RawCommandRequest } from './allowlist'

export interface AnalysisOutput {
  items: AnalyzedItem[]
  findings: Finding[]
  commandRequests: RawCommandRequest[]
}

export interface ClaudeResult {
  sessionId: string
  output: AnalysisOutput
}

const COMMAND_IDS: CommandId[] = [
  'docker_logs',
  'docker_inspect',
  'systemctl_status',
  'journal_tail',
  'read_config',
  'list_dir',
  'http_head'
]

const str = { type: 'string' }
const int = { type: 'integer' }

/** Shared by the audit and the chat: the read-only commands the model may ask for. */
export const COMMAND_REQUESTS_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['command_id', 'server_id', 'args', 'reason'],
    properties: {
      command_id: { type: 'string', enum: COMMAND_IDS },
      server_id: int,
      args: {
        type: 'object',
        additionalProperties: { type: ['string', 'integer'] }
      },
      reason: str
    }
  }
}

export const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'findings', 'command_requests'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['server_id', 'ref', 'what_it_is', 'project_guess', 'confidence'],
        properties: {
          server_id: int,
          ref: str,
          what_it_is: str,
          project_guess: str,
          confidence: { type: 'number', minimum: 0, maximum: 1 }
        }
      }
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'key',
          'server_id',
          'severity',
          'title',
          'explanation',
          'evidence_refs',
          'suggested_question',
          'suggested_action'
        ],
        properties: {
          key: str,
          server_id: { type: ['integer', 'null'] },
          severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
          title: str,
          explanation: str,
          evidence_refs: { type: 'array', items: str },
          suggested_question: str,
          suggested_action: str
        }
      }
    },
    command_requests: COMMAND_REQUESTS_SCHEMA
  }
}

export const FINAL_ROUND_NOTE =
  'This is the last round: no more commands can run, so command_requests must be empty.'

export const COMMANDS_HELP = `Only these command_id values and arguments are available:
   - docker_logs {container, n≤200}; docker_inspect {container}
   - systemctl_status {unit}; journal_tail {unit, n≤200}
   - read_config {path}: files in /etc/nginx/, /etc/caddy/, /etc/systemd/system/ and docker-compose*.yml in /opt, /srv, /home, /root
   - list_dir {path}: the same directories, /opt, /srv, /home/<user>/apps
   - http_head {url}: only this server's own domains
   The user confirms every command by hand, so ask only for what you really need.`

export const SYSTEM_PROMPT = `You audit a personal VPS. You get the server's description (with its price), its service registry, a fresh snapshot of the server, signals from deterministic rules and the user's past decisions.

Tasks:
1. items: for every container, service or site whose purpose is not obvious from the registry, briefly say what it is (what_it_is), which project it belongs to (project_guess) and how sure you are (confidence 0..1).
2. findings: what needs the user's attention: forgotten and outdated services, things running for no reason, risks, duplicates. Do not repeat rule signals word for word: add an explanation or skip them. Do not raise issues the user has already decided on.
   key is a stable ASCII identifier of the form <topic>:<server_id>:<object>, the same across runs for the same problem.
3. command_requests: if you lack data for a conclusion, ask for commands. ${COMMANDS_HELP}

Be brief and to the point. Refer to specific container, unit and domain names from the snapshots.`

const LANGUAGE_NAMES: Record<Lang, string> = { en: 'English', ru: 'Russian' }

/** Appended to a system prompt so Claude writes for the user in the interface language. */
export const replyLanguageNote = (lang: Lang): string =>
  `Write all text meant for the user in ${LANGUAGE_NAMES[lang]}.`

const LABEL_WHITELIST = (key: string): boolean =>
  key.startsWith('traefik.') || key.startsWith('coolify.') || key === 'com.docker.compose.project'

/** Drops noisy labels and masks secrets in the free-form parts (cron lines, label values). */
export function trimSnapshot(s: Snapshot): unknown {
  return {
    ...s,
    containers: s.containers.map((c) => ({
      ...c,
      labels: Object.fromEntries(
        Object.entries(c.labels)
          .filter(([k]) => LABEL_WHITELIST(k))
          .map(([k, v]) => [k, maskSecrets(v)])
      )
    })),
    cron: s.cron.map(maskSecrets)
  }
}

export function snapshotChanges(
  prev: Snapshot | null,
  cur: Snapshot
): {
  addedContainers: string[]
  removedContainers: string[]
  addedUnits: string[]
  removedUnits: string[]
} {
  if (!prev) return { addedContainers: [], removedContainers: [], addedUnits: [], removedUnits: [] }
  const diff = (a: string[], b: string[]): string[] => a.filter((x) => !b.includes(x))
  const containers = (s: Snapshot): string[] => s.containers.map((c) => c.name)
  const units = (s: Snapshot): string[] => s.units.map((u) => u.name)
  return {
    addedContainers: diff(containers(cur), containers(prev)),
    removedContainers: diff(containers(prev), containers(cur)),
    addedUnits: diff(units(cur), units(prev)),
    removedUnits: diff(units(prev), units(cur))
  }
}

export const json = (value: unknown): string =>
  '```json\n' + JSON.stringify(value, null, 1) + '\n```'

export function buildAnalysisPrompt(i: {
  servers: Server[]
  services: Service[]
  snapshots: Snapshot[]
  previous: Snapshot[]
  signals: Finding[]
  decisions: Decision[]
  finalRound: boolean
}): string {
  const servers = i.servers.map((s) => ({
    id: s.id,
    name: s.name,
    provider: s.provider,
    project: s.project,
    monthlyCost: s.monthlyCost,
    currency: s.currency,
    notes: s.notes
  }))
  const services = i.services.map((s) => ({
    serverId: s.serverId,
    name: s.name,
    kind: s.kind,
    url: s.url,
    port: s.port,
    description: s.description,
    expected: s.expected,
    notes: s.notes
  }))
  const snapshots = i.snapshots.map((s) => ({
    snapshot: trimSnapshot(s),
    changesSincePrevious: snapshotChanges(
      i.previous.find((p) => p.serverId === s.serverId) ?? null,
      s
    )
  }))
  const signals = i.signals.map(({ key, serverId, severity, title, explanation }) => ({
    key,
    serverId,
    severity,
    title,
    explanation
  }))
  return [
    '## Servers',
    json(servers),
    '## Service registry',
    json(services),
    '## Snapshots',
    json(snapshots),
    '## Rule signals',
    json(signals),
    '## User decisions',
    json(i.decisions),
    ...(i.finalRound ? [FINAL_ROUND_NOTE] : [])
  ].join('\n\n')
}

export function buildFollowUpPrompt(
  results: { request: CommandRequest; output: string | null; declined: boolean }[],
  finalRound: boolean,
  instruction = 'Update the full answer per the schema, taking this data into account.'
): string {
  const parts = ['Results of the requested commands:']
  for (const { request, output, declined } of results) {
    const head = `### ${request.commandId} on server ${request.serverId}: ${request.command ?? JSON.stringify(request.args)}`
    if (request.error) parts.push(`${head}\nRejected by the allowlist: ${request.error}`)
    else if (declined) parts.push(`${head}\nThe user declined this command.`)
    else parts.push(`${head}\n\`\`\`\n${output ?? ''}\n\`\`\``)
  }
  parts.push(instruction)
  if (finalRound) parts.push(FINAL_ROUND_NOTE)
  return parts.join('\n\n')
}

const isExecutable = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function loginShellLookup(env: NodeJS.ProcessEnv): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      env.SHELL || '/bin/zsh',
      ['-lc', 'command -v claude'],
      { env, timeout: 5000 },
      (err, stdout) => resolve(err ? null : stdout.trim().split('\n').pop() || null)
    )
  })
}

/** Apps launched from Finder don't inherit the user's PATH, so look in the login shell too. */
export async function resolveClaudeBin(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const candidates = [env.KENNEL_CLAUDE_BIN, await loginShellLookup(env)]
  if (env.HOME) candidates.push(join(env.HOME, '.local/bin/claude'))
  for (const c of candidates) if (c && (await isExecutable(c))) return c
  throw new Error(t('main.claudeNotFound'))
}

interface RawOutput {
  items?: {
    server_id: number
    ref: string
    what_it_is: string
    project_guess: string
    confidence: number
  }[]
  findings?: {
    key: string
    server_id: number | null
    severity: Severity
    title: string
    explanation: string
    evidence_refs: string[]
    suggested_question: string
    suggested_action: string
  }[]
  command_requests?: RawCommandRequest[]
}

function toOutput(raw: RawOutput): AnalysisOutput {
  return {
    items: (raw.items ?? []).map((i) => ({
      serverId: i.server_id,
      ref: i.ref,
      whatItIs: i.what_it_is,
      projectGuess: i.project_guess,
      confidence: i.confidence
    })),
    findings: (raw.findings ?? []).map((f) => ({
      key: f.key.startsWith('llm:') ? f.key : `llm:${f.key}`,
      serverId: f.server_id,
      severity: f.severity,
      title: f.title,
      explanation: f.explanation,
      evidenceRefs: f.evidence_refs ?? [],
      suggestedQuestion: f.suggested_question,
      suggestedAction: f.suggested_action,
      source: 'llm',
      code: null,
      registryCandidate: null
    })),
    commandRequests: raw.command_requests ?? []
  }
}

export interface ClaudeCall {
  bin: string
  prompt: string
  resume?: string
  /** Sessions are stored per working directory; keep it stable so they don't pile up. */
  cwd?: string
  timeoutMs?: number
  /** Aborting kills the CLI process. */
  signal?: AbortSignal
}

/** One `claude -p` call that must answer with JSON matching `schema`. */
export async function invokeClaude<T>(
  o: ClaudeCall & { schema: object; systemPrompt: string }
): Promise<{ sessionId: string; output: T }> {
  const args = [
    '-p',
    '--output-format',
    'json',
    '--tools',
    '',
    '--json-schema',
    JSON.stringify(o.schema),
    '--system-prompt',
    o.systemPrompt,
    // The prompt carries text from servers (logs, labels), so the session gets no way to act on
    // it: no user settings or hooks, no CLAUDE.md, no MCP servers, no skills.
    '--restricted',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--disallowedTools',
    'mcp__*',
    ...(o.resume ? ['--resume', o.resume] : [])
  ]
  // An empty working directory keeps project files out of the session.
  const cwd = o.cwd ?? join(tmpdir(), 'kennel-claude')
  await mkdir(cwd, { recursive: true })
  const { code, stdout, stderr } = await new Promise<{
    code: number | null
    stdout: string
    stderr: string
  }>((resolve, reject) => {
    const child = spawn(o.bin, args, { cwd, env: process.env, signal: o.signal })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`Claude CLI timed out after ${o.timeoutMs ?? 300_000} ms`))
    }, o.timeoutMs ?? 300_000)
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      resolve({ code: exitCode, stdout, stderr })
    })
    child.stdin.on('error', () => {}) // EPIPE when the CLI is killed before reading the prompt
    child.stdin.end(o.prompt)
  })
  let parsed: {
    is_error?: boolean
    result?: string
    session_id?: string
    structured_output?: T
  } | null
  try {
    parsed = JSON.parse(stdout)
  } catch {
    parsed = null
  }
  if (parsed?.is_error) throw new Error(`Claude CLI: ${parsed.result || 'error'}`)
  if (code !== 0) {
    throw new Error(`Claude CLI exited with code ${code}: ${(stderr || stdout).slice(-500)}`)
  }
  if (!parsed?.structured_output || !parsed.session_id) {
    throw new Error('Claude CLI returned no structured output')
  }
  return { sessionId: parsed.session_id, output: parsed.structured_output }
}

export async function runClaude(o: ClaudeCall): Promise<ClaudeResult> {
  const { sessionId, output } = await invokeClaude<RawOutput>({
    ...o,
    schema: ANALYSIS_SCHEMA,
    systemPrompt: `${SYSTEM_PROMPT}\n\n${replyLanguageNote(getLang())}`
  })
  return { sessionId, output: toOutput(output) }
}
