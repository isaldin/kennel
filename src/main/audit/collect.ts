import { connect as tlsConnect } from 'tls'
import type {
  CertInfo,
  ContainerInfo,
  DiskUsage,
  HostInfo,
  ListeningPort,
  Snapshot,
  UnitInfo,
  Vhost
} from '../../shared/audit'
import type { Server } from '../../shared/types'
import type { ExecResult } from '../sshConnect'

/**
 * Read-only collection script, piped to `bash -s`. Each section prints
 * `@@begin <name>`, its stdout, then `@@end <name> <exit code>`; stderr is dropped.
 */
export const COLLECT_SCRIPT = String.raw`
export LC_ALL=C
section() {
  echo "@@begin $1"
  out=$(eval "$2" 2>/dev/null)
  rc=$?
  [ -n "$out" ] && printf '%s\n' "$out"
  echo "@@end $1 $rc"
}
section host 'echo "hostname=$(hostname)"; echo "kernel=$(uname -r)"; (. /etc/os-release && echo "os=$PRETTY_NAME"); echo "uptime=$(cut -d" " -f1 /proc/uptime)"; echo "nproc=$(nproc)"; echo "load=$(cut -d" " -f1-3 /proc/loadavg)"; awk "/^MemTotal:/{print \"memTotalKb=\"\$2} /^MemAvailable:/{print \"memAvailableKb=\"\$2}" /proc/meminfo'
section upgradable 'if command -v apt >/dev/null; then apt list --upgradable 2>/dev/null | grep -c upgradable; true; elif command -v dnf >/dev/null; then dnf -q check-update | grep -c "^[a-zA-Z0-9]"; true; else exit 1; fi'
section disks 'df -B1 --output=target,fstype,size,used -x tmpfs -x devtmpfs -x overlay -x squashfs'
section containers 'ids=$(docker ps -aq) && if [ -z "$ids" ]; then echo "[]"; else docker inspect $ids; fi'
section images 'imgs=$(docker ps -aq | xargs -r docker inspect -f "{{.Image}}" | sort -u) && if [ -n "$imgs" ]; then docker image inspect --format "{{.Id}} {{.Created}}" $imgs; fi'
section units 'systemctl list-units --type=service --all --no-legend --plain'
section custom_units 'ls -1 /etc/systemd/system/*.service'
section ports 'ss -Htlnp'
section nginx 'nginx -T'
section caddy 'cat /etc/caddy/Caddyfile'
section logs 'stat -c "%Y %n" /var/log/nginx/*access*.log'
section cron 'crontab -l; cat /etc/cron.d/*'
`

interface Section {
  body: string
  ok: boolean
}

function splitSections(raw: string): { sections: Map<string, Section>; unavailable: string[] } {
  const sections = new Map<string, Section>()
  const unavailable: string[] = []
  let name: string | null = null
  let lines: string[] = []
  const close = (rc: number | null): void => {
    if (name === null) return
    const body = lines.join('\n')
    const ok = rc !== null && (rc === 0 || body.trim() !== '')
    sections.set(name, { body, ok })
    if (!ok) unavailable.push(name)
    name = null
    lines = []
  }
  for (const line of raw.split('\n')) {
    const begin = /^@@begin (\S+)$/.exec(line)
    const end = /^@@end (\S+) (\d+)$/.exec(line)
    if (begin) {
      close(null)
      name = begin[1]
    } else if (end && end[1] === name) {
      close(Number(end[2]))
    } else if (name !== null) {
      lines.push(line)
    }
  }
  close(null) // output cut off mid-section
  return { sections, unavailable }
}

const isoOrNull = (value: string | undefined): string | null => {
  if (!value || value.startsWith('0001-')) return null
  const t = Date.parse(value)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

function parseHost(body: string, upgradable: Section | undefined): HostInfo {
  const kv = new Map<string, string>()
  for (const line of body.split('\n')) {
    const i = line.indexOf('=')
    if (i > 0) kv.set(line.slice(0, i), line.slice(i + 1).trim())
  }
  const num = (k: string): number => Number(kv.get(k)) || 0
  const load = (kv.get('load') ?? '').split(/\s+/).map(Number)
  const upg = upgradable?.ok ? Number.parseInt(upgradable.body.trim(), 10) : NaN
  return {
    hostname: kv.get('hostname') ?? '',
    os: kv.get('os') ?? '',
    kernel: kv.get('kernel') ?? '',
    uptimeSec: num('uptime'),
    nproc: num('nproc'),
    load: [load[0] || 0, load[1] || 0, load[2] || 0],
    memTotal: num('memTotalKb') * 1024,
    memAvailable: num('memAvailableKb') * 1024,
    upgradable: Number.isNaN(upg) ? null : upg
  }
}

function parseDisks(body: string): DiskUsage[] {
  return body
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols.length >= 4)
    .map((cols) => {
      const [fs, size, used] = cols.slice(-3)
      return { mount: cols.slice(0, -3).join(' '), fs, size: Number(size), used: Number(used) }
    })
    .filter((d) => d.size > 0)
}

interface DockerInspect {
  Id: string
  Name: string
  Image: string
  RestartCount?: number
  State?: { Status?: string; StartedAt?: string }
  Config?: { Image?: string; Labels?: Record<string, string> | null }
  NetworkSettings?: {
    Ports?: Record<string, { HostIp: string; HostPort: string }[] | null> | null
  }
}

function parseContainers(body: string, images: Map<string, string>): ContainerInfo[] {
  let list: DockerInspect[]
  try {
    list = JSON.parse(body) as DockerInspect[]
  } catch {
    return []
  }
  return list.map((c) => ({
    id: c.Id,
    name: c.Name.replace(/^\//, ''),
    image: c.Config?.Image ?? '',
    imageId: c.Image,
    imageCreatedAt: isoOrNull(images.get(c.Image)),
    state: c.State?.Status ?? '',
    startedAt: isoOrNull(c.State?.StartedAt),
    restartCount: c.RestartCount ?? 0,
    ports: Object.entries(c.NetworkSettings?.Ports ?? {}).flatMap(([port, bindings]) =>
      bindings?.length ? bindings.map((b) => `${b.HostIp}:${b.HostPort}->${port}`) : [port]
    ),
    labels: c.Config?.Labels ?? {}
  }))
}

function parseImages(body: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of body.split('\n')) {
    const [id, created] = line.trim().split(/\s+/)
    if (id && created) map.set(id, created)
  }
  return map
}

function parseUnits(body: string, custom: string): UnitInfo[] {
  const customNames = new Set(
    custom
      .split('\n')
      .map((p) => p.trim().split('/').pop() ?? '')
      .filter(Boolean)
  )
  return body
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols.length >= 4 && cols[0].endsWith('.service'))
    .map(([name, , active, sub]) => ({ name, active, sub, custom: customNames.has(name) }))
}

function parsePorts(body: string): ListeningPort[] {
  const ports: ListeningPort[] = []
  for (const line of body.split('\n')) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 5) continue
    const local = cols[3]
    const i = local.lastIndexOf(':')
    const port = Number(local.slice(i + 1))
    if (i < 0 || !port) continue
    const address = local
      .slice(0, i)
      .replace(/^\[|\]$/g, '')
      .replace(/%.*$/, '')
    const process = /users:\(\("([^"]+)"/.exec(line)?.[1] ?? ''
    ports.push({ address, port, process })
  }
  return ports
}

/** Bodies of top-level `server { … }` blocks in `nginx -T` output. */
function nginxServerBlocks(text: string): string[] {
  const clean = text.replace(/#[^\n]*/g, '')
  const blocks: string[] = []
  const re = /\bserver\s*\{/g
  let m: RegExpExecArray | null
  while ((m = re.exec(clean))) {
    let depth = 1
    let i = m.index + m[0].length
    for (; i < clean.length && depth > 0; i++) {
      if (clean[i] === '{') depth++
      else if (clean[i] === '}') depth--
    }
    blocks.push(clean.slice(m.index + m[0].length, i - 1))
    re.lastIndex = i
  }
  return blocks
}

const isRealDomain = (d: string): boolean =>
  /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d) && !d.startsWith('.')

function parseNginx(text: string, logMtimes: Map<string, string>): Vhost[] {
  const vhosts: Vhost[] = []
  for (const block of nginxServerBlocks(text)) {
    const names = /\bserver_name\s+([^;]+);/.exec(block)?.[1].split(/\s+/) ?? []
    const upstream =
      /\bproxy_pass\s+([^;]+);/.exec(block)?.[1].trim() ??
      /\broot\s+([^;]+);/.exec(block)?.[1].trim() ??
      ''
    const log = /\baccess_log\s+([^\s;]+)/.exec(block)?.[1]
    const accessLogMtime = log ? (logMtimes.get(log) ?? null) : null
    for (const domain of names.filter(isRealDomain)) {
      vhosts.push({ domain: domain.toLowerCase(), source: 'nginx', upstream, accessLogMtime })
    }
  }
  return vhosts
}

function parseCaddy(text: string): Vhost[] {
  const vhosts: Vhost[] = []
  let depth = 0
  let current: string[] = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    if (depth === 0 && line.endsWith('{')) {
      current = line
        .slice(0, -1)
        .split(/[\s,]+/)
        .map((a) => a.replace(/^https?:\/\//, '').replace(/:\d+$/, ''))
        .filter(isRealDomain)
    }
    const proxy = depth === 1 ? /^reverse_proxy\s+(\S+)/.exec(line) : null
    if (proxy) {
      for (const v of vhosts) if (current.includes(v.domain) && !v.upstream) v.upstream = proxy[1]
    }
    if (depth === 0 && line.endsWith('{')) {
      for (const domain of current) {
        vhosts.push({ domain, source: 'caddy', upstream: '', accessLogMtime: null })
      }
    }
    depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0)
  }
  return vhosts
}

function traefikVhosts(containers: ContainerInfo[]): Vhost[] {
  const vhosts: Vhost[] = []
  for (const c of containers) {
    for (const [key, value] of Object.entries(c.labels)) {
      if (!/^traefik\.http\.routers\.[^.]+\.rule$/.test(key)) continue
      for (const host of value.matchAll(/Host\(([^)]*)\)/g)) {
        for (const domain of host[1].matchAll(/`([^`]+)`/g)) {
          vhosts.push({
            domain: domain[1],
            source: 'traefik',
            upstream: c.name,
            accessLogMtime: null
          })
        }
      }
    }
  }
  return vhosts
}

function parseLogMtimes(body: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of body.split('\n')) {
    const m = /^(\d+)\s+(.+)$/.exec(line.trim())
    if (m) map.set(m[2], new Date(Number(m[1]) * 1000).toISOString())
  }
  return map
}

export function parseCollectOutput(serverId: number, takenAt: string, raw: string): Snapshot {
  const { sections, unavailable } = splitSections(raw)
  const body = (name: string): string => {
    const s = sections.get(name)
    return s?.ok ? s.body : ''
  }
  const containers = parseContainers(body('containers'), parseImages(body('images')))
  const seen = new Set<string>()
  const vhosts = [
    ...traefikVhosts(containers),
    ...parseNginx(body('nginx'), parseLogMtimes(body('logs'))),
    ...parseCaddy(body('caddy'))
  ].filter((v) => {
    const key = `${v.source}:${v.domain}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return {
    serverId,
    takenAt,
    host: sections.get('host')?.ok ? parseHost(body('host'), sections.get('upgradable')) : null,
    disks: parseDisks(body('disks')),
    containers,
    units: parseUnits(body('units'), body('custom_units')),
    ports: parsePorts(body('ports')),
    vhosts,
    certs: [],
    cron: body('cron')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#')),
    unavailable
  }
}

export function snapshotDomains(s: Snapshot): string[] {
  return [...new Set(s.vhosts.map((v) => v.domain))]
}

function checkCert(target: string, timeoutMs: number): Promise<CertInfo> {
  const [host, port] = target.split(':')
  return new Promise((resolve) => {
    const done = (notAfter: string | null, error: string | null): void => {
      socket.destroy()
      resolve({ domain: target, notAfter, error })
    }
    const socket = tlsConnect({
      host,
      port: Number(port) || 443,
      servername: host,
      rejectUnauthorized: false,
      timeout: timeoutMs
    })
    socket.once('secureConnect', () => {
      const validTo = socket.getPeerCertificate().valid_to
      done(validTo ? isoOrNull(validTo) : null, validTo ? null : 'No certificate')
    })
    socket.once('timeout', () => done(null, 'Timed out'))
    socket.once('error', (err) => done(null, err.message))
  })
}

/** Checked from this machine, so it works whatever proxy terminates TLS on the server. */
export async function checkCerts(domains: string[], timeoutMs = 5000): Promise<CertInfo[]> {
  const results: CertInfo[] = new Array(domains.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < domains.length) {
      const i = next++
      results[i] = await checkCert(domains[i], timeoutMs)
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, domains.length) }, worker))
  return results
}

export async function collect(
  server: Server,
  exec: (command: string, stdin: string) => Promise<ExecResult>
): Promise<Snapshot> {
  const takenAt = new Date().toISOString()
  const result = await exec('bash -s', COLLECT_SCRIPT)
  if (!result.stdout.includes('@@begin')) {
    throw new Error(result.stderr.trim() || `Collector exited with code ${result.code}`)
  }
  const snapshot = parseCollectOutput(server.id, takenAt, result.stdout)
  snapshot.certs = await checkCerts(snapshotDomains(snapshot))
  return snapshot
}
