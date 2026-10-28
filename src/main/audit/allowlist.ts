import { randomUUID } from 'crypto'
import { posix } from 'path'
import type { CommandRequest, Snapshot } from '../../shared/audit'
import type { ExecResult } from '../sshConnect'
import { snapshotDomains } from './collect'

/** Command request as the model returns it (snake_case, untyped args). */
export interface RawCommandRequest {
  command_id: string
  server_id: number
  args: Record<string, unknown>
  reason: string
}

const MAX_LINES = 200
const DEFAULT_LINES = 100
const MAX_CONFIG_BYTES = 65536

const CONFIG_DIRS = ['/etc/nginx', '/etc/caddy', '/etc/systemd/system']
const COMPOSE_ROOTS = ['/opt', '/srv', '/home', '/root']
const COMPOSE_FILE = /^(docker-)?compose[\w.-]*\.ya?ml$/
const LIST_DIRS = [...CONFIG_DIRS, '/opt', '/srv']
const HOME_APPS = /^\/home\/[^/]+\/apps(\/|$)/

const CONTAINER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/
const UNIT_NAME = /^[a-zA-Z0-9][a-zA-Z0-9@_.:-]*$/

/** Single-quotes a value for POSIX sh. */
export function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

class Rejected extends Error {}

const within = (path: string, dir: string): boolean => path === dir || path.startsWith(dir + '/')

function lines(value: unknown): number {
  if (value === undefined) return DEFAULT_LINES
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > MAX_LINES) {
    throw new Rejected(`n must be between 1 and ${MAX_LINES}`)
  }
  return n
}

function container(value: unknown, snapshot: Snapshot): string {
  const name = String(value ?? '')
  if (!CONTAINER_NAME.test(name)) throw new Rejected('Invalid container name')
  if (!snapshot.containers.some((c) => c.name === name || c.id === name)) {
    throw new Rejected(`Container ${name} is not in the server snapshot`)
  }
  return name
}

function unit(value: unknown, snapshot: Snapshot): string {
  const name = String(value ?? '')
  if (!UNIT_NAME.test(name)) throw new Rejected('Invalid unit name')
  const found = snapshot.units.find((u) => u.name === name || u.name === `${name}.service`)
  if (!found) throw new Rejected(`Unit ${name} is not in the server snapshot`)
  return found.name
}

function absolutePath(value: unknown): string {
  const raw = String(value ?? '')
  if (raw.includes('\0') || !raw.startsWith('/') || raw.split('/').includes('..')) {
    throw new Rejected('Invalid path')
  }
  const path = posix.normalize(raw)
  return path.length > 1 ? path.replace(/\/$/, '') : path
}

function configPath(value: unknown): string {
  const path = absolutePath(value)
  if (CONFIG_DIRS.some((d) => path.startsWith(d + '/'))) return path
  if (COMPOSE_FILE.test(posix.basename(path)) && COMPOSE_ROOTS.some((d) => within(path, d))) {
    return path
  }
  throw new Rejected('Path is outside the allowed directories')
}

function listPath(value: unknown): string {
  const path = absolutePath(value)
  if (LIST_DIRS.some((d) => within(path, d)) || HOME_APPS.test(path)) return path
  throw new Rejected('Path is outside the allowed directories')
}

function serverUrl(value: unknown, snapshot: Snapshot): string {
  let url: URL
  try {
    url = new URL(String(value ?? ''))
  } catch {
    throw new Rejected('Invalid URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Rejected('Only http(s) is allowed')
  if (!snapshotDomains(snapshot).includes(url.hostname)) {
    throw new Rejected(`Domain ${url.hostname} is not served by this server`)
  }
  return url.toString()
}

function render(commandId: string, args: Record<string, unknown>, snapshot: Snapshot): string {
  switch (commandId) {
    case 'docker_logs':
      return `docker logs --tail ${lines(args.n)} ${shq(container(args.container, snapshot))}`
    case 'docker_inspect':
      return `docker inspect ${shq(container(args.container, snapshot))}`
    case 'systemctl_status':
      return `systemctl status --no-pager ${shq(unit(args.unit, snapshot))}`
    case 'journal_tail':
      return `journalctl -u ${shq(unit(args.unit, snapshot))} -n ${lines(args.n)} --no-pager`
    case 'read_config':
      return `head -c ${MAX_CONFIG_BYTES} -- ${shq(configPath(args.path))}`
    case 'list_dir':
      return `ls -la -- ${shq(listPath(args.path))}`
    case 'http_head':
      return `curl -sI --max-time 5 ${shq(serverUrl(args.url, snapshot))}`
    default:
      throw new Rejected('Command is not in the allowlist')
  }
}

/** Exactly one of `command` / `error` is set; requests with an error are never executed. */
export function validateRequest(raw: RawCommandRequest, snapshot: Snapshot | null): CommandRequest {
  const args = Object.fromEntries(
    Object.entries(raw.args ?? {}).map(([k, v]) => [k, typeof v === 'number' ? v : String(v)])
  )
  const base = {
    id: randomUUID(),
    serverId: raw.server_id,
    commandId: raw.command_id,
    args,
    reason: raw.reason
  }
  try {
    if (!snapshot) throw new Rejected('No snapshot of this server')
    return { ...base, command: render(raw.command_id, raw.args ?? {}, snapshot), error: null }
  } catch (err) {
    if (!(err instanceof Rejected)) throw err
    return { ...base, command: null, error: err.message }
  }
}

export function maskSecrets(text: string): string {
  return text
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[key hidden]')
    .replace(/(authorization\s*:\s*).+/gi, '$1***')
    .replace(
      /\b(\w*(?:PASS|SECRET|TOKEN|KEY|DSN|CREDENTIAL)\w*["']?\s*[=:]\s*["']?)[^\s"',]+/gi,
      '$1***'
    )
    .replace(/(\b[a-z][\w+.-]*:\/\/)[^\s/@]+@/gi, '$1***@')
    .replace(/\b[sr]k_live_\w+/g, '***')
    .replace(/(\s-p)[^\s"']+/g, '$1***')
    .replace(/\$(?:apr1|2[aby]|1|5|6)\$[^\s"',]+/g, '***')
}

/** Masks command output; for `docker inspect`, also drops every Env value (names are enough). */
export function sanitizeOutput(commandId: string, text: string): string {
  if (commandId === 'docker_inspect') {
    try {
      const items = JSON.parse(text) as { Config?: { Env?: string[] } }[]
      for (const item of items) {
        if (item.Config?.Env) {
          item.Config.Env = item.Config.Env.map((e) => `${e.split('=')[0]}=***`)
        }
      }
      text = JSON.stringify(items, null, 1)
    } catch {
      // Not JSON (e.g. an error message): fall through to regex masking.
    }
  }
  return maskSecrets(text)
}

export function clipOutput(text: string, max = 20_000): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n…[clipped ${text.length - max} characters]`
}

/**
 * Runs one validated request; the output is masked and clipped before it can reach the model.
 * Errors come back as text so the model can see what went wrong.
 */
export async function executeRequest(
  request: CommandRequest,
  exec: (command: string) => Promise<ExecResult>
): Promise<string> {
  if (!request.command) return 'Error: command rejected'
  try {
    const { stdout, stderr, code } = await exec(request.command)
    const out = sanitizeOutput(request.commandId, stdout)
    const text = stderr.trim() ? `${out}\n[stderr]\n${maskSecrets(stderr)}` : out
    return clipOutput(`${text}\n[exit ${code}]`)
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`
  }
}
