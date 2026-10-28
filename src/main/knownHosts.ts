import { createHash, createHmac } from 'crypto'
import { appendFileSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'fs'

export type HostKeyStatus = 'match' | 'unknown' | 'changed'

export interface KnownHostEntry {
  marker: string
  patterns: string[]
  keyType: string
  key: string
}

/** OpenSSH writes non-default ports as `[host]:port`. */
export const hostPattern = (host: string, port: number): string =>
  port === 22 ? host : `[${host}]:${port}`

export function keyTypeOf(blob: Buffer): string {
  const len = blob.readUInt32BE(0)
  return blob.subarray(4, 4 + len).toString('ascii')
}

export function fingerprint(blob: Buffer): string {
  return 'SHA256:' + createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')
}

export function parseKnownHosts(text: string): KnownHostEntry[] {
  const entries: KnownHostEntry[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const parts = line.split(/\s+/)
    const marker = parts[0].startsWith('@') ? parts.shift()! : ''
    if (parts.length < 3) continue
    entries.push({ marker, patterns: parts[0].split(','), keyType: parts[1], key: parts[2] })
  }
  return entries
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`, 'i')
}

export function patternMatches(pattern: string, host: string): boolean {
  if (pattern.startsWith('|1|')) {
    const [, , salt, hash] = pattern.split('|')
    if (!salt || !hash) return false
    const digest = createHmac('sha1', Buffer.from(salt, 'base64')).update(host).digest('base64')
    return digest === hash
  }
  if (pattern.startsWith('!')) return false
  return globToRegExp(pattern).test(host)
}

function entryMatchesHost(entry: KnownHostEntry, host: string): boolean {
  if (entry.patterns.some((p) => p.startsWith('!') && globToRegExp(p.slice(1)).test(host))) {
    return false
  }
  return entry.patterns.some((p) => patternMatches(p, host))
}

export function checkHostKey(entries: KnownHostEntry[], host: string, blob: Buffer): HostKeyStatus {
  const keyType = keyTypeOf(blob)
  const key = blob.toString('base64')
  const relevant = entries.filter(
    (e) => e.marker !== '@cert-authority' && entryMatchesHost(e, host)
  )
  if (relevant.some((e) => e.marker === '@revoked' && e.key === key)) return 'changed'
  if (relevant.some((e) => e.marker === '' && e.keyType === keyType && e.key === key))
    return 'match'
  if (relevant.some((e) => e.marker === '' && e.keyType === keyType)) return 'changed'
  return 'unknown'
}

export class KnownHostsFile {
  constructor(private readonly path: string) {}

  read(): KnownHostEntry[] {
    return existsSync(this.path) ? parseKnownHosts(readFileSync(this.path, 'utf8')) : []
  }

  check(host: string, blob: Buffer): HostKeyStatus {
    return checkHostKey(this.read(), host, blob)
  }

  add(host: string, blob: Buffer): void {
    const line = `${host} ${keyTypeOf(blob)} ${blob.toString('base64')}\n`
    const existing = existsSync(this.path) ? readFileSync(this.path, 'utf8') : ''
    const prefix = existing && !existing.endsWith('\n') ? '\n' : ''
    appendFileSync(this.path, prefix + line, { mode: 0o600 })
  }

  /** Drops entries for `host` with the same key type, keeping a `.old` backup like `ssh-keygen -R`. */
  replace(host: string, blob: Buffer): void {
    const keyType = keyTypeOf(blob)
    if (existsSync(this.path)) {
      copyFileSync(this.path, `${this.path}.old`)
      const kept = readFileSync(this.path, 'utf8')
        .split('\n')
        .filter((raw) => {
          const [entry] = parseKnownHosts(raw)
          return (
            !entry ||
            entry.marker !== '' ||
            entry.keyType !== keyType ||
            !entryMatchesHost(entry, host)
          )
        })
      writeFileSync(this.path, kept.join('\n'), { mode: 0o600 })
    }
    this.add(host, blob)
  }
}
