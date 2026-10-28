import type { ServiceKind } from './types'

export interface HostInfo {
  hostname: string
  os: string
  kernel: string
  uptimeSec: number
  nproc: number
  load: [number, number, number]
  memTotal: number
  memAvailable: number
  upgradable: number | null
}

export interface DiskUsage {
  mount: string
  fs: string
  size: number
  used: number
}

export interface ContainerInfo {
  id: string
  name: string
  image: string
  imageId: string
  imageCreatedAt: string | null
  state: string
  startedAt: string | null
  restartCount: number
  ports: string[]
  labels: Record<string, string>
}

export interface UnitInfo {
  name: string
  active: string
  sub: string
  /** Unit file lives in /etc/systemd/system, i.e. installed by hand rather than by a package. */
  custom: boolean
}

export interface ListeningPort {
  address: string
  port: number
  process: string
}

export interface Vhost {
  domain: string
  source: 'nginx' | 'caddy' | 'traefik'
  upstream: string
  /** mtime of the vhost's own access log; null when it logs to a shared file or is unknown. */
  accessLogMtime: string | null
}

export interface CertInfo {
  domain: string
  notAfter: string | null
  error: string | null
}

export interface Snapshot {
  serverId: number
  takenAt: string
  host: HostInfo | null
  disks: DiskUsage[]
  containers: ContainerInfo[]
  units: UnitInfo[]
  ports: ListeningPort[]
  vhosts: Vhost[]
  certs: CertInfo[]
  cron: string[]
  /** Collector sections that failed (no binary, no permission). */
  unavailable: string[]
}

export type Severity = 'info' | 'warning' | 'critical'

export type RuleCode =
  | 'stale_image'
  | 'no_traffic'
  | 'duplicate'
  | 'crashloop'
  | 'public_port'
  | 'unknown'
  | 'missing'
  | 'idle_server'
  | 'ssl_expiry'
  | 'disk_full'

export interface RegistryCandidate {
  serverId: number
  name: string
  kind: ServiceKind
}

export interface Finding {
  /** Stable across runs; user decisions are keyed by it. */
  key: string
  serverId: number | null
  severity: Severity
  title: string
  explanation: string
  evidenceRefs: string[]
  suggestedQuestion: string
  suggestedAction: string
  source: 'rule' | 'llm'
  code: RuleCode | null
  /** Set for `unknown` findings: "keep" adds this to the service registry. */
  registryCandidate: RegistryCandidate | null
}

export interface AnalyzedItem {
  serverId: number
  ref: string
  whatItIs: string
  projectGuess: string
  confidence: number
}

export type CommandId =
  | 'docker_logs'
  | 'docker_inspect'
  | 'systemctl_status'
  | 'journal_tail'
  | 'read_config'
  | 'list_dir'
  | 'http_head'

export interface CommandRequest {
  id: string
  serverId: number
  commandId: string
  args: Record<string, string | number>
  reason: string
  /** Rendered shell command when the request passed the allowlist. */
  command: string | null
  /** Why the allowlist rejected it; such requests are never executed. */
  error: string | null
}

export type DecisionKind = 'keep' | 'remove_planned' | 'migrate' | 'ignore_until'

export interface Decision {
  key: string
  kind: DecisionKind
  until: string | null
  note: string
  decidedAt: string
}

export type DecisionInput = Omit<Decision, 'key' | 'decidedAt'>

export type AuditStatus = 'collecting' | 'analyzing' | 'awaiting_confirmation' | 'done' | 'failed'

/** analyzerError of a run the user stopped. */
export const AUDIT_STOPPED = 'Остановлено пользователем'

export interface AuditRun {
  id: number
  /** The audited server; null only for runs from before audits became per-server. */
  serverId: number | null
  trigger: 'manual' | 'scheduled'
  status: AuditStatus
  startedAt: string
  finishedAt: string | null
  round: number
  serverErrors: { serverId: number; message: string }[]
  analyzerError: string | null
  findings: Finding[]
  items: AnalyzedItem[]
  pendingCommands: CommandRequest[]
}

export interface Thresholds {
  staleImageDays: number
  noTrafficDays: number
  idleRamPct: number
  idleCpuPct: number
  sslDays: number
  diskPct: number
  publicPorts: number[]
}

/** Choices for the automatic re-audit period, in hours; 0 means off. */
export const AUTO_AUDIT_HOURS = [0, 6, 12, 24, 168]
export const DEFAULT_AUTO_AUDIT_HOURS = 24

export const DEFAULT_THRESHOLDS: Thresholds = {
  staleImageDays: 180,
  noTrafficDays: 30,
  idleRamPct: 15,
  idleCpuPct: 5,
  sslDays: 14,
  diskPct: 85,
  publicPorts: [5432, 3306, 6379, 27017, 9200, 11211, 5672]
}

/** A decision hides a finding unless it is an `ignore_until` whose date has passed. */
export function isDecided(decision: Decision | undefined, now: Date): boolean {
  if (!decision) return false
  if (decision.kind !== 'ignore_until') return true
  return decision.until !== null && Date.parse(decision.until) > now.getTime()
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'commands'
  text: string
  at: string
  /** For `commands` messages: what the model asked to run and what became of it. */
  commands?: { command: string; status: 'ran' | 'declined' | 'rejected' }[]
}

export type ChatStatus = 'idle' | 'thinking' | 'awaiting_confirmation'

/** A conversation with Claude about one audit finding. */
export interface FindingChat {
  serverId: number
  findingKey: string
  title: string
  sessionId: string | null
  messages: ChatMessage[]
  status: ChatStatus
  /** Command rounds used for the current question. */
  round: number
  pendingCommands: CommandRequest[]
  error: string | null
  /** When Claude started on the current question; null while idle. */
  startedAt: string | null
}
