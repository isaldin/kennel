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
        title: `Образ ${c.name} не обновлялся ${days} дн.`,
        explanation: `Контейнер ${c.name} запущен из образа ${c.image}, собранного ${days} дней назад.`,
        suggestedQuestion: 'Этот сервис ещё нужен? Если да, его стоит пересобрать или обновить.',
        suggestedAction: 'Обновить образ или удалить контейнер'
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
        title: `${v.domain}: нет запросов ${days} дн.`,
        explanation: `Access log сайта ${v.domain} не менялся ${days} дней.`,
        suggestedQuestion: 'Сайтом кто-то пользуется?',
        suggestedAction: 'Отключить сайт или проверить DNS'
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
        title: `${c.name} перезапускается`,
        explanation: grew
          ? `Счётчик перезапусков вырос с ${before.restartCount} до ${c.restartCount} с прошлого снимка.`
          : `Контейнер в состоянии restarting.`,
        suggestedAction: 'Посмотреть логи контейнера'
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
        title: `Порт ${p.port} открыт наружу`,
        explanation: `${p.process || 'Процесс'} слушает ${p.address}:${p.port}. Базы и кэши обычно не должны быть доступны из интернета.`,
        suggestedAction: 'Привязать к 127.0.0.1 или закрыть фаерволом'
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
      title: `Неизвестный контейнер ${c.name}`,
      explanation: `Контейнер ${c.name} (${c.image}, ${c.state}) не записан в реестр сервисов.`,
      suggestedQuestion: 'Что это и нужно ли оно?',
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
      title: `Неизвестный сервис ${u.name}`,
      explanation: `systemd unit ${u.name} (${u.active}) установлен вручную и не записан в реестр.`,
      suggestedQuestion: 'Что это и нужно ли оно?',
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
        title: `${s.name} не работает`,
        explanation: `Сервис ${s.name} (${s.kind}) отмечен как обязательный, но не найден среди работающих.`,
        suggestedAction: 'Проверить и перезапустить, или снять пометку «должен работать»'
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
        title: `Сервер ${server.name} простаивает`,
        explanation: `Средняя загрузка за ${hosts.length} снимк.: RAM ${ramPct.toFixed(0)}%, CPU ${cpuPct.toFixed(1)}%, при этом он стоит ${server.monthlyCost} ${server.currency}/мес.`,
        suggestedQuestion: 'Можно перенести сервисы на другой сервер и удалить этот?',
        suggestedAction: 'Рассмотреть консолидацию'
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
          ? `Сертификат ${c.domain} истёк`
          : `Сертификат ${c.domain} истекает через ${Math.floor(daysLeft)} дн.`,
      explanation: `Срок действия сертификата: ${c.notAfter}.`,
      suggestedAction: 'Проверить автопродление (certbot / Caddy / Traefik)'
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
        title: `Диск ${d.mount} заполнен на ${pct.toFixed(0)}%`,
        explanation: `Занято ${d.used} из ${d.size} байт.`,
        suggestedAction: 'Почистить docker images / логи или расширить диск'
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
      title: `${repo} запущен на ${ids.size} серверах`,
      explanation: `Образ ${repo} работает на: ${[...ids].map((id) => names.get(id)).join(', ')}.`,
      suggestedQuestion: 'Можно оставить один экземпляр?',
      suggestedAction: 'Рассмотреть объединение'
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
