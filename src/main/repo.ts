import type { Db } from './db'
import type { Server, ServerInput, Service, ServiceInput, ServiceKind } from '../shared/types'

interface ServerRow {
  id: number
  name: string
  provider: string
  host: string
  port: number
  username: string
  ssh_alias: string
  identity_file: string
  enpass_item_uuid: string
  monthly_cost: number
  currency: string
  billing_day: number | null
  project: string
  panel_url: string
  notes: string
  created_at: string
  updated_at: string
}

interface ServiceRow {
  id: number
  server_id: number
  name: string
  kind: string
  url: string
  port: number | null
  description: string
  enpass_item_uuid: string
  expected: number
  notes: string
  created_at: string
  updated_at: string
}

const toServer = (r: ServerRow): Server => ({
  id: r.id,
  name: r.name,
  provider: r.provider,
  host: r.host,
  port: r.port,
  username: r.username,
  sshAlias: r.ssh_alias,
  identityFile: r.identity_file,
  enpassItemUuid: r.enpass_item_uuid,
  monthlyCost: r.monthly_cost,
  currency: r.currency,
  billingDay: r.billing_day,
  project: r.project,
  panelUrl: r.panel_url,
  notes: r.notes,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const toService = (r: ServiceRow): Service => ({
  id: r.id,
  serverId: r.server_id,
  name: r.name,
  kind: r.kind as ServiceKind,
  url: r.url,
  port: r.port,
  description: r.description,
  enpassItemUuid: r.enpass_item_uuid,
  expected: r.expected === 1,
  notes: r.notes,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const serverParams = (s: ServerInput): Record<string, unknown> => ({
  name: s.name.trim(),
  provider: s.provider.trim(),
  host: s.host.trim(),
  port: s.port || 22,
  username: s.username.trim(),
  ssh_alias: s.sshAlias.trim(),
  identity_file: s.identityFile.trim(),
  enpass_item_uuid: s.enpassItemUuid,
  monthly_cost: Number(s.monthlyCost) || 0,
  currency: s.currency.trim() || 'USD',
  billing_day: s.billingDay,
  project: s.project.trim(),
  panel_url: s.panelUrl.trim(),
  notes: s.notes
})

const serviceParams = (s: ServiceInput): Record<string, unknown> => ({
  server_id: s.serverId,
  name: s.name.trim(),
  kind: s.kind,
  url: s.url.trim(),
  port: s.port,
  description: s.description,
  enpass_item_uuid: s.enpassItemUuid,
  expected: s.expected ? 1 : 0,
  notes: s.notes
})

export class Repo {
  constructor(private readonly db: Db) {}

  listServers(): Server[] {
    const rows = this.db.prepare('SELECT * FROM servers ORDER BY name COLLATE NOCASE').all()
    return (rows as ServerRow[]).map(toServer)
  }

  getServer(id: number): Server {
    const row = this.db.prepare('SELECT * FROM servers WHERE id = ?').get(id) as
      ServerRow | undefined
    if (!row) throw new Error(`Server ${id} not found`)
    return toServer(row)
  }

  createServer(input: ServerInput): Server {
    const result = this.db
      .prepare(
        `INSERT INTO servers (name, provider, host, port, username, ssh_alias, identity_file,
           enpass_item_uuid, monthly_cost, currency, billing_day, project, panel_url, notes)
         VALUES (@name, @provider, @host, @port, @username, @ssh_alias, @identity_file,
           @enpass_item_uuid, @monthly_cost, @currency, @billing_day, @project, @panel_url, @notes)`
      )
      .run(serverParams(input))
    return this.getServer(Number(result.lastInsertRowid))
  }

  updateServer(id: number, input: ServerInput): Server {
    this.db
      .prepare(
        `UPDATE servers SET name=@name, provider=@provider, host=@host, port=@port,
           username=@username, ssh_alias=@ssh_alias, identity_file=@identity_file,
           enpass_item_uuid=@enpass_item_uuid, monthly_cost=@monthly_cost, currency=@currency,
           billing_day=@billing_day, project=@project, panel_url=@panel_url, notes=@notes,
           updated_at=datetime('now')
         WHERE id=@id`
      )
      .run({ ...serverParams(input), id })
    return this.getServer(id)
  }

  removeServer(id: number): void {
    this.db.prepare('DELETE FROM servers WHERE id = ?').run(id)
  }

  listServices(serverId?: number): Service[] {
    const rows =
      serverId === undefined
        ? this.db.prepare('SELECT * FROM services ORDER BY name COLLATE NOCASE').all()
        : this.db
            .prepare('SELECT * FROM services WHERE server_id = ? ORDER BY name COLLATE NOCASE')
            .all(serverId)
    return (rows as ServiceRow[]).map(toService)
  }

  getService(id: number): Service {
    const row = this.db.prepare('SELECT * FROM services WHERE id = ?').get(id) as
      ServiceRow | undefined
    if (!row) throw new Error(`Service ${id} not found`)
    return toService(row)
  }

  createService(input: ServiceInput): Service {
    const result = this.db
      .prepare(
        `INSERT INTO services (server_id, name, kind, url, port, description, enpass_item_uuid, expected, notes)
         VALUES (@server_id, @name, @kind, @url, @port, @description, @enpass_item_uuid, @expected, @notes)`
      )
      .run(serviceParams(input))
    return this.getService(Number(result.lastInsertRowid))
  }

  updateService(id: number, input: ServiceInput): Service {
    this.db
      .prepare(
        `UPDATE services SET server_id=@server_id, name=@name, kind=@kind, url=@url, port=@port,
           description=@description, enpass_item_uuid=@enpass_item_uuid, expected=@expected,
           notes=@notes, updated_at=datetime('now')
         WHERE id=@id`
      )
      .run({ ...serviceParams(input), id })
    return this.getService(id)
  }

  removeService(id: number): void {
    this.db.prepare('DELETE FROM services WHERE id = ?').run(id)
  }
}
