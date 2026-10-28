import type { AuditRun, Decision, DecisionInput, FindingChat, Snapshot, Thresholds } from './audit'

export interface Server {
  id: number
  name: string
  provider: string
  host: string
  port: number
  username: string
  /** Host alias in ~/.ssh/config; when set, connection params are resolved from it. */
  sshAlias: string
  identityFile: string
  enpassItemUuid: string
  monthlyCost: number
  currency: string
  billingDay: number | null
  project: string
  panelUrl: string
  notes: string
  createdAt: string
  updatedAt: string
}

export type ServerInput = Omit<Server, 'id' | 'createdAt' | 'updatedAt'>

export type ServiceKind = 'docker' | 'systemd' | 'coolify' | 'other'

export interface Service {
  id: number
  serverId: number
  name: string
  kind: ServiceKind
  url: string
  port: number | null
  description: string
  enpassItemUuid: string
  /** The user expects this service to be running (used by the monitoring phase). */
  expected: boolean
  notes: string
  createdAt: string
  updatedAt: string
}

export type ServiceInput = Omit<Service, 'id' | 'createdAt' | 'updatedAt'>

export interface SshConfigHost {
  alias: string
  hostName: string
  user: string
  port: number
  identityFile: string
  alreadyImported: boolean
}

export interface EnpassStatus {
  vaultPath: string | null
  unlocked: boolean
}

/** Non-secret view of an Enpass item; passwords never cross into the renderer. */
export interface EnpassItem {
  uuid: string
  title: string
  subtitle: string
  category: string
  username: string
  url: string
  hasPassword: boolean
}

export interface HostKeyPrompt {
  promptId: string
  host: string
  port: number
  keyType: string
  fingerprint: string
  /** 'unknown' = first connection, 'changed' = differs from known_hosts. */
  kind: 'unknown' | 'changed'
}

export interface SessionEvent {
  sessionId: string
  type: 'data' | 'status' | 'closed' | 'error'
  data?: string
  message?: string
}

export interface Api {
  servers: {
    list(): Promise<Server[]>
    create(input: ServerInput): Promise<Server>
    update(id: number, input: ServerInput): Promise<Server>
    remove(id: number): Promise<void>
  }
  services: {
    list(serverId?: number): Promise<Service[]>
    create(input: ServiceInput): Promise<Service>
    update(id: number, input: ServiceInput): Promise<Service>
    remove(id: number): Promise<void>
  }
  sshConfig: {
    hosts(): Promise<SshConfigHost[]>
    importHosts(aliases: string[]): Promise<Server[]>
  }
  enpass: {
    status(): Promise<EnpassStatus>
    unlock(masterPassword: string): Promise<void>
    lock(): Promise<void>
    search(query: string): Promise<EnpassItem[]>
    get(uuid: string): Promise<EnpassItem | null>
    copyPassword(uuid: string): Promise<void>
  }
  ssh: {
    open(serverId: number, cols: number, rows: number): Promise<string>
    write(sessionId: string, data: string): void
    resize(sessionId: string, cols: number, rows: number): void
    close(sessionId: string): void
    answerHostKey(promptId: string, accept: boolean): void
    onEvent(listener: (event: SessionEvent) => void): () => void
    onHostKeyPrompt(listener: (prompt: HostKeyPrompt) => void): () => void
  }
  audit: {
    latest(serverId: number): Promise<AuditRun | null>
    start(serverId: number): Promise<AuditRun>
    stop(serverId: number): void
    answerCommands(runId: number, approvedIds: string[]): void
    decide(key: string, input: DecisionInput): Promise<Decision>
    decisions(): Promise<Decision[]>
    thresholds(): Promise<Thresholds>
    setThresholds(t: Thresholds): Promise<void>
    /** Hours between automatic re-audits of each server; 0 turns them off. */
    autoAuditHours(): Promise<number>
    setAutoAuditHours(hours: number): Promise<void>
    snapshot(serverId: number): Promise<Snapshot | null>
    onUpdate(listener: (run: AuditRun) => void): () => void
    /** Fired with the server id when the user clicks an audit notification. */
    onFocus(listener: (serverId: number) => void): () => void
  }
  chat: {
    get(serverId: number, findingKey: string): Promise<FindingChat | null>
    /** Finding keys of this server that already have a chat. */
    keys(serverId: number): Promise<string[]>
    send(serverId: number, findingKey: string, text: string): Promise<FindingChat>
    stop(serverId: number, findingKey: string): void
    answerCommands(serverId: number, findingKey: string, approvedIds: string[]): void
    onUpdate(listener: (chat: FindingChat) => void): () => void
  }
  /** Zooms the whole window (interface scale). */
  setZoom(factor: number): void
  openExternal(url: string): void
}
