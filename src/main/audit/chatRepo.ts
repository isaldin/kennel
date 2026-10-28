import type { Db } from '../db'
import { INTERRUPTED, type FindingChat } from '../../shared/audit'

export class ChatRepo {
  constructor(private readonly db: Db) {}

  get(serverId: number, findingKey: string): FindingChat | null {
    const row = this.db
      .prepare('SELECT data FROM finding_chats WHERE server_id = ? AND finding_key = ?')
      .get(serverId, findingKey) as { data: string } | undefined
    return row ? (JSON.parse(row.data) as FindingChat) : null
  }

  save(chat: FindingChat): void {
    this.db
      .prepare(
        `INSERT INTO finding_chats (server_id, finding_key, data) VALUES (?, ?, ?)
         ON CONFLICT(server_id, finding_key) DO UPDATE SET data = excluded.data`
      )
      .run(chat.serverId, chat.findingKey, JSON.stringify(chat))
  }

  /** Finding keys of this server that have a chat. */
  keys(serverId: number): string[] {
    const rows = this.db
      .prepare('SELECT finding_key FROM finding_chats WHERE server_id = ? ORDER BY finding_key')
      .all(serverId) as { finding_key: string }[]
    return rows.map((r) => r.finding_key)
  }

  /** Answers a previous app session left pending can never arrive; reset those chats. */
  failInterrupted(): void {
    const rows = this.db.prepare('SELECT data FROM finding_chats').all() as { data: string }[]
    for (const row of rows) {
      const chat = JSON.parse(row.data) as FindingChat
      if (chat.status === 'idle') continue
      this.save({
        ...chat,
        status: 'idle',
        pendingCommands: [],
        startedAt: null,
        error: INTERRUPTED
      })
    }
  }
}
