import Database from 'better-sqlite3-multiple-ciphers'
import { createDecipheriv, pbkdf2Sync } from 'crypto'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
import type { EnpassItem, EnpassStatus } from '../shared/types'

/** The Mac App Store build keeps the live vault inside its sandbox container. */
const VAULT_CANDIDATES = [
  join(homedir(), 'Library/Containers/in.sinew.Enpass-Desktop/Data/Documents/Vaults/primary'),
  join(homedir(), 'Documents/Enpass/Vaults/primary')
]

interface VaultInfo {
  kdf_iter: number
  have_keyfile: number
}

interface ItemRow {
  uuid: string
  title: string
  subtitle: string
  category: string
  key: Buffer
}

interface FieldRow {
  type: string
  value: string
  label: string
}

export function findVault(): string | null {
  return VAULT_CANDIDATES.find((dir) => existsSync(join(dir, 'vault.enpassdb'))) ?? null
}

/** PBKDF2-HMAC-SHA512 over the master password; SQLCipher gets the first 32 bytes as a raw key. */
export function deriveDbKey(masterPassword: string, salt: Buffer, iterations: number): Buffer {
  return pbkdf2Sync(Buffer.from(masterPassword, 'utf8'), salt, iterations, 64, 'sha512').subarray(
    0,
    32
  )
}

/** Password fields are AES-256-GCM: item key = 32-byte key + 12-byte nonce, AAD = item UUID bytes. */
export function decryptField(hexValue: string, itemKey: Buffer, uuid: string): string {
  if (!hexValue) return ''
  const key = itemKey.subarray(0, 32)
  const nonce = itemKey.subarray(32)
  if (nonce.length === 0) throw new Error('Item key has no nonce (item was deleted)')
  const data = Buffer.from(hexValue, 'hex')
  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAAD(Buffer.from(uuid.replace(/-/g, ''), 'hex'))
  decipher.setAuthTag(data.subarray(data.length - 16))
  return Buffer.concat([
    decipher.update(data.subarray(0, data.length - 16)),
    decipher.final()
  ]).toString('utf8')
}

/**
 * Read-only access to the Enpass vault. The live file is copied to a private temp dir
 * so Enpass's own locks and sync are never touched; nothing is ever written back.
 */
export class EnpassVault {
  private db: Database.Database | null = null
  private tempDir: string | null = null

  /** `vaultDir` overrides auto-detection (used by tests). */
  constructor(private readonly vaultDir: string | null = null) {}

  private locateVault(): string | null {
    return this.vaultDir ?? findVault()
  }

  status(): EnpassStatus {
    return { vaultPath: this.locateVault(), unlocked: this.db !== null }
  }

  unlock(masterPassword: string): void {
    this.lock()
    const vaultDir = this.locateVault()
    if (!vaultDir) throw new Error('Enpass vault not found')
    const info = JSON.parse(readFileSync(join(vaultDir, 'vault.json'), 'utf8')) as VaultInfo
    if (info.have_keyfile) throw new Error('Vaults protected with a keyfile are not supported yet')

    this.tempDir = mkdtempSync(join(tmpdir(), 'kennel-enpass-'))
    const copy = join(this.tempDir, 'vault.enpassdb')
    copyFileSync(join(vaultDir, 'vault.enpassdb'), copy)
    // Uncheckpointed changes live in the WAL while Enpass is running.
    for (const suffix of ['-wal', '-shm']) {
      const source = join(vaultDir, `vault.enpassdb${suffix}`)
      if (existsSync(source)) copyFileSync(source, copy + suffix)
    }

    const salt = readFileSync(copy).subarray(0, 16)
    const hexKey = deriveDbKey(masterPassword, salt, info.kdf_iter).toString('hex')

    for (const legacy of [4, 3]) {
      const db = new Database(copy, { readonly: true, fileMustExist: true })
      try {
        db.pragma(`cipher='sqlcipher'`)
        db.pragma(`legacy=${legacy}`)
        db.pragma(`key="x'${hexKey}'"`)
        db.prepare('SELECT count(*) FROM item').get()
        this.db = db
        return
      } catch {
        db.close()
      }
    }
    this.lock()
    throw new Error('Wrong master password')
  }

  lock(): void {
    this.db?.close()
    this.db = null
    if (this.tempDir) rmSync(this.tempDir, { recursive: true, force: true })
    this.tempDir = null
  }

  search(query: string, limit = 50): EnpassItem[] {
    const like = `%${query.trim()}%`
    const rows = this.requireDb()
      .prepare(
        `SELECT DISTINCT item.uuid, item.title, item.subtitle, item.category, item.key
         FROM item LEFT JOIN itemfield f ON f.item_uuid = item.uuid AND f.deleted = 0 AND f.type = 'url'
         WHERE item.deleted = 0 AND item.trashed = 0
           AND (item.title LIKE @q OR item.subtitle LIKE @q OR f.value LIKE @q)
         ORDER BY item.title COLLATE NOCASE LIMIT @limit`
      )
      .all({ q: like, limit }) as ItemRow[]
    return rows.map((row) => this.toItem(row))
  }

  get(uuid: string): EnpassItem | null {
    const row = this.findRow(uuid)
    return row ? this.toItem(row) : null
  }

  /** Secret value of the item's first password field; stays in the main process. */
  password(uuid: string): string {
    const row = this.findRow(uuid)
    if (!row) throw new Error('Enpass item not found')
    const field = this.fields(uuid).find((f) => f.type === 'password' && f.value)
    if (!field) throw new Error(`"${row.title}" has no password`)
    return decryptField(field.value, row.key, uuid)
  }

  private findRow(uuid: string): ItemRow | undefined {
    return this.requireDb()
      .prepare(
        'SELECT uuid, title, subtitle, category, key FROM item WHERE uuid = ? AND deleted = 0'
      )
      .get(uuid) as ItemRow | undefined
  }

  private fields(uuid: string): FieldRow[] {
    return this.requireDb()
      .prepare(
        'SELECT type, value, label FROM itemfield WHERE item_uuid = ? AND deleted = 0 ORDER BY orde'
      )
      .all(uuid) as FieldRow[]
  }

  private toItem(row: ItemRow): EnpassItem {
    const fields = this.fields(row.uuid)
    const firstOf = (type: string): string =>
      fields.find((f) => f.type === type && f.value)?.value ?? ''
    return {
      uuid: row.uuid,
      title: row.title,
      subtitle: row.subtitle,
      category: row.category,
      username: firstOf('username') || firstOf('email'),
      url: firstOf('url'),
      hasPassword: fields.some((f) => f.type === 'password' && f.value)
    }
  }

  private requireDb(): Database.Database {
    if (!this.db) throw new Error('Enpass is locked')
    return this.db
  }
}
