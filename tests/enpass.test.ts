import Database from 'better-sqlite3-multiple-ciphers'
import { createCipheriv, randomBytes } from 'crypto'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { EnpassVault, decryptField, deriveDbKey } from '../src/main/enpass'

const MASTER = 'correct horse battery staple'
const ITERATIONS = 1000

/** Mirrors how Enpass stores a password field (AES-256-GCM, AAD = UUID bytes). */
function encryptField(plain: string, uuid: string): { value: string; itemKey: Buffer } {
  const key = randomBytes(32)
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(Buffer.from(uuid.replace(/-/g, ''), 'hex'))
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()])
  return { value: data.toString('hex'), itemKey: Buffer.concat([key, nonce]) }
}

/** Builds a SQLCipher v4 vault keyed the way Enpass keys it (PBKDF2 over the file's salt). */
function makeVault(): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'enpass-test-')), 'primary')
  mkdirSync(dir)
  const path = join(dir, 'vault.enpassdb')
  writeFileSync(join(dir, 'vault.json'), JSON.stringify({ kdf_iter: ITERATIONS, have_keyfile: 0 }))

  // Enpass derives the key from the file's salt, so pick the salt up front: a raw
  // `x'<key><salt>'` key pins it (rekey would generate a fresh salt).
  const salt = randomBytes(16)
  const key = deriveDbKey(MASTER, salt, ITERATIONS).toString('hex')
  const db = new Database(path)
  db.pragma(`cipher='sqlcipher'`)
  db.pragma(`legacy=4`)
  db.pragma(`key="x'${key}${salt.toString('hex')}'"`)
  db.exec(`CREATE TABLE item (uuid TEXT, title TEXT, subtitle TEXT, category TEXT, key BLOB,
             deleted INTEGER, trashed INTEGER);
           CREATE TABLE itemfield (item_uuid TEXT, type TEXT, label TEXT, value TEXT,
             deleted INTEGER, orde INTEGER);`)

  const uuid = '1b4e28ba-2fa1-11d2-883f-0016d3cca427'
  const secret = encryptField('s3cret-pass', uuid)
  db.prepare('INSERT INTO item VALUES (?, ?, ?, ?, ?, 0, 0)').run(
    uuid,
    'Contabo VPS',
    'root',
    'login',
    secret.itemKey
  )
  const field = db.prepare('INSERT INTO itemfield VALUES (?, ?, ?, ?, 0, ?)')
  field.run(uuid, 'username', 'Username', 'root', 1)
  field.run(uuid, 'password', 'Password', secret.value, 2)
  field.run(uuid, 'url', 'URL', 'https://my.contabo.com', 3)
  db.close()
  return dir
}

describe('Enpass', () => {
  it('decryptField round-trips an AES-GCM field', () => {
    const uuid = '00112233-4455-6677-8899-aabbccddeeff'
    const { value, itemKey } = encryptField('пароль', uuid)
    expect(decryptField(value, itemKey, uuid)).toBe('пароль')
    expect(() => decryptField(value, itemKey, '00000000-0000-0000-0000-000000000000')).toThrow()
  })

  it('unlocks a vault, searches without exposing secrets, and reads the password', () => {
    const vault = new EnpassVault(makeVault())
    expect(() => vault.unlock('wrong')).toThrow('Wrong master password')
    expect(vault.status().unlocked).toBe(false)

    vault.unlock(MASTER)
    const [item] = vault.search('contabo')
    expect(item).toMatchObject({
      title: 'Contabo VPS',
      username: 'root',
      url: 'https://my.contabo.com',
      hasPassword: true
    })
    expect(JSON.stringify(item)).not.toContain('s3cret')
    expect(vault.search('my.contabo.com')).toHaveLength(1)
    expect(vault.password(item.uuid)).toBe('s3cret-pass')

    vault.lock()
    expect(() => vault.search('contabo')).toThrow('Enpass is locked')
  })
})
