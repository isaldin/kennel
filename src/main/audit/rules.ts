import type {
  ContainerInfo,
  Finding,
  RegistryCandidate,
  RuleCode,
  Severity,
  Snapshot,
  Thresholds
} from '../../shared/audit'
import type { Server, Service } from '../../shared/types'
import { t as tr } from '../i18n'

export interface RulesInput {
  servers: Server[]
  services: Service[]
  /** serverId → snapshots, newest first. */
  snapshots: Map<number, Snapshot[]>
  thresholds: Thresholds
  now: Date
}

/** Infrastructure images expected on many servers; never reported as duplicates. */
export const IGNORED_DUPLICATE_IMAGES = /^(ghcr\.io\/coollabsio\/|traefik)/

/** Coolify's own containers; not user services. */
const COOLIFY_INFRA = /^coolify(-|$)/

const DAY_MS = 86_400_000

const norm = (s: string): string => s.trim().toLowerCase()

const nameMatches = (a: string, b: string): boolean => {
  const x = norm(a)
  const y = norm(b)
  return x !== '' && y !== '' && (x.includes(y) || y.includes(x))
}

const containerNames = (c: ContainerInfo): string[] =>
  [c.name, c.labels['coolify.name'] ?? ''].filter(Boolean)

const unitBase = (name: string): string => name.replace(/\.service$/, '')

/** Image repository without tag or digest: `ghcr.io/me/app:1.2@sha256:…` → `ghcr.io/me/app`. */
export function imageRepo(image: string): string {
  const noDigest = image.split('@')[0]
  const slash = noDigest.lastIndexOf('/')
  const colon = noDigest.lastIndexOf(':')
  return colon > slash ? noDigest.slice(0, colon) : noDigest
}

interface Draft {
  code: RuleCode
  serverId: number | null
  subject: string
  severity: Severity
  title: string
  explanation: string
  suggestedQuestion?: string
  suggestedAction?: string
  registryCandidate?: RegistryCandidate
}

const toFinding = (d: Draft): Finding => ({
  key: `${d.code}:${d.serverId ?? '*'}:${d.subject}`,
  serverId: d.serverId,
  severity: d.severity,
  title: d.title,
  explanation: d.explanation,
  evidenceRefs: [d.subject],
  suggestedQuestion: d.suggestedQuestion ?? '',
  suggestedAction: d.suggestedAction ?? '',
  source: 'rule',
  code: d.code,
  registryCandidate: d.registryCandidate ?? null
})

const ageDays = (iso: string, now: Date): number => (now.getTime() - Date.parse(iso)) / DAY_MS

function serverRules(
  server: Server,
  snapshots: Snapshot[],
  services: Service[],
  t: Thresholds,
  now: Date
): Draft[] {
  const [cur, prev] = snapshots
  const out: Draft[] = []
  const id = server.id

  for (const c of cur.containers) {
    if (c.imageCreatedAt && ageDays(c.imageCreatedAt, now) > t.staleImageDays) {
      const days = Math.floor(ageDays(c.imageCreatedAt, now))
      out.push({
        code: 'stale_image',
        serverId: id,
        subject: c.name,
        severity: 'info',
        title: tr('rules.staleImage.title', { name: c.name, count: days }),
        explanation: tr('rules.staleImage.explanation', {
          name: c.name,
          image: c.image,
          count: days
        }),
        suggestedQuestion: tr('rules.staleImage.question'),
        suggestedAction: tr('rules.staleImage.action')
      })
    }
  }

  for (const v of cur.vhosts) {
    if (v.accessLogMtime && ageDays(v.accessLogMtime, now) > t.noTrafficDays) {
      const days = Math.floor(ageDays(v.accessLogMtime, now))
      out.push({
        code: 'no_traffic',
        serverId: id,
        subject: v.domain,
        severity: 'info',
        title: tr('rules.noTraffic.title', { domain: v.domain, count: days }),
        explanation: tr('rules.noTraffic.explanation', { domain: v.domain, count: days }),
        suggestedQuestion: tr('rules.noTraffic.question'),
        suggestedAction: tr('rules.noTraffic.action')
      })
    }
  }

  for (const c of cur.containers) {
    const before = prev?.containers.find((p) => p.name === c.name)
    const grew = before !== undefined && c.restartCount > before.restartCount
    if (c.state === 'restarting' || grew) {
      out.push({
        code: 'crashloop',
        serverId: id,
        subject: c.name,
        severity: 'critical',
        title: tr('rules.crashloop.title', { name: c.name }),
        explanation: grew
          ? tr('rules.crashloop.grew', { before: before.restartCount, after: c.restartCount })
          : tr('rules.crashloop.restarting'),
        suggestedAction: tr('rules.crashloop.action')
      })
    }
  }

  const publicPorts = new Set(t.publicPorts)
  const seenPorts = new Set<number>()
  for (const p of cur.ports) {
    if (['0.0.0.0', '::', '*'].includes(p.address) && publicPorts.has(p.port)) {
      if (seenPorts.has(p.port)) continue
      seenPorts.add(p.port)
      out.push({
        code: 'public_port',
        serverId: id,
        subject: String(p.port),
        severity: 'critical',
        title: tr('rules.publicPort.title', { port: p.port }),
        explanation: tr('rules.publicPort.explanation', {
          process: p.process || tr('rules.publicPort.process'),
          address: p.address,
          port: p.port
        }),
        suggestedAction: tr('rules.publicPort.action')
      })
    }
  }

  const registry = services.filter((s) => s.serverId === id)
  for (const c of cur.containers) {
    if (COOLIFY_INFRA.test(c.name)) continue
    if (registry.some((s) => containerNames(c).some((n) => nameMatches(n, s.name)))) continue
    const coolify = c.labels['coolify.managed'] === 'true'
    const name = c.labels['coolify.name'] ?? c.name
    out.push({
      code: 'unknown',
      serverId: id,
      subject: c.name,
      severity: 'info',
      title: tr('rules.unknownContainer.title', { name: c.name }),
      explanation: tr('rules.unknownContainer.explanation', {
        name: c.name,
        image: c.image,
        state: c.state
      }),
      suggestedQuestion: tr('rules.unknown.question'),
      registryCandidate: { serverId: id, name, kind: coolify ? 'coolify' : 'docker' }
    })
  }
  for (const u of cur.units) {
    if (!u.custom) continue
    if (registry.some((s) => nameMatches(unitBase(u.name), s.name))) continue
    out.push({
      code: 'unknown',
      serverId: id,
      subject: u.name,
      severity: 'info',
      title: tr('rules.unknownUnit.title', { name: u.name }),
      explanation: tr('rules.unknownUnit.explanation', { name: u.name, state: u.active }),
      suggestedQuestion: tr('rules.unknown.question'),
      registryCandidate: { serverId: id, name: unitBase(u.name), kind: 'systemd' }
    })
  }

  // An empty list from a section that failed to collect says nothing about what runs.
  const collected = (section: string): boolean => !cur.unavailable.includes(section)
  for (const s of registry.filter((x) => x.expected)) {
    let running: boolean
    if (s.kind === 'docker' || s.kind === 'coolify') {
      if (!collected('containers')) continue
      running = cur.containers.some(
        (c) => c.state === 'running' && containerNames(c).some((n) => nameMatches(n, s.name))
      )
    } else if (s.kind === 'systemd') {
      if (!collected('units')) continue
      running = cur.units.some(
        (u) => u.active === 'active' && nameMatches(unitBase(u.name), s.name)
      )
    } else if (s.port !== null) {
      if (!collected('ports')) continue
      running = cur.ports.some((p) => p.port === s.port)
    } else {
      continue
    }
    if (!running) {
      out.push({
        code: 'missing',
        serverId: id,
        subject: s.name,
        severity: 'critical',
        title: tr('rules.missing.title', { name: s.name }),
        explanation: tr('rules.missing.explanation', { name: s.name, kind: s.kind }),
        suggestedAction: tr('rules.missing.action')
      })
    }
  }

  const hosts = snapshots
    .slice(0, 7)
    .flatMap((s) => (s.host && s.host.memTotal > 0 ? [s.host] : []))
  if (server.monthlyCost > 0 && hosts.length > 0) {
    const avg = (f: (h: (typeof hosts)[number]) => number): number =>
      hosts.reduce((sum, h) => sum + f(h), 0) / hosts.length
    const ramPct = avg((h) => (1 - h.memAvailable / h.memTotal) * 100)
    const cpuPct = avg((h) => (h.load[2] / Math.max(h.nproc, 1)) * 100)
    if (ramPct < t.idleRamPct && cpuPct < t.idleCpuPct) {
      out.push({
        code: 'idle_server',
        serverId: id,
        subject: 'host',
        severity: 'warning',
        title: tr('rules.idle.title', { name: server.name }),
        explanation: tr('rules.idle.explanation', {
          count: hosts.length,
          ram: ramPct.toFixed(0),
          cpu: cpuPct.toFixed(1),
          cost: server.monthlyCost,
          currency: server.currency
        }),
        suggestedQuestion: tr('rules.idle.question'),
        suggestedAction: tr('rules.idle.action')
      })
    }
  }

  for (const c of cur.certs) {
    if (!c.notAfter) continue
    const daysLeft = -ageDays(c.notAfter, now)
    if (daysLeft >= t.sslDays) continue
    out.push({
      code: 'ssl_expiry',
      serverId: id,
      subject: c.domain,
      severity: daysLeft < 0 ? 'critical' : 'warning',
      title:
        daysLeft < 0
          ? tr('rules.ssl.expired', { domain: c.domain })
          : tr('rules.ssl.expiring', { domain: c.domain, count: Math.floor(daysLeft) }),
      explanation: tr('rules.ssl.explanation', { notAfter: c.notAfter }),
      suggestedAction: tr('rules.ssl.action')
    })
  }

  for (const d of cur.disks) {
    const pct = (d.used / d.size) * 100
    if (pct > t.diskPct) {
      out.push({
        code: 'disk_full',
        serverId: id,
        subject: d.mount,
        severity: 'warning',
        title: tr('rules.disk.title', { mount: d.mount, pct: pct.toFixed(0) }),
        explanation: tr('rules.disk.explanation', { used: d.used, size: d.size }),
        suggestedAction: tr('rules.disk.action')
      })
    }
  }

  return out
}

function duplicateRules(servers: Server[], latest: Map<number, Snapshot>): Draft[] {
  const byRepo = new Map<string, Set<number>>()
  for (const server of servers) {
    for (const c of latest.get(server.id)?.containers ?? []) {
      const repo = imageRepo(c.image)
      if (!repo || IGNORED_DUPLICATE_IMAGES.test(repo) || COOLIFY_INFRA.test(c.name)) continue
      if (!byRepo.has(repo)) byRepo.set(repo, new Set())
      byRepo.get(repo)!.add(server.id)
    }
  }
  const names = new Map(servers.map((s) => [s.id, s.name]))
  return [...byRepo]
    .filter(([, ids]) => ids.size >= 2)
    .map(([repo, ids]) => ({
      code: 'duplicate',
      serverId: null,
      subject: repo,
      severity: 'info',
      title: tr('rules.duplicate.title', { repo, count: ids.size }),
      explanation: tr('rules.duplicate.explanation', {
        repo,
        servers: [...ids].map((id) => names.get(id)).join(', ')
      }),
      suggestedQuestion: tr('rules.duplicate.question'),
      suggestedAction: tr('rules.duplicate.action')
    }))
}

export function runRules(input: RulesInput): Finding[] {
  const drafts: Draft[] = []
  const latest = new Map<number, Snapshot>()
  for (const server of input.servers) {
    const snapshots = input.snapshots.get(server.id) ?? []
    if (snapshots.length === 0) continue
    latest.set(server.id, snapshots[0])
    drafts.push(...serverRules(server, snapshots, input.services, input.thresholds, input.now))
  }
  drafts.push(...duplicateRules(input.servers, latest))
  return drafts.map(toFinding)
}
