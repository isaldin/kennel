import { createHmac, randomBytes } from 'crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  KnownHostsFile,
  checkHostKey,
  fingerprint,
  hostPattern,
  keyTypeOf,
  parseKnownHosts
} from '../src/main/knownHosts'

function keyBlob(type: string, body: string): Buffer {
  const name = Buffer.from(type)
  const len = Buffer.alloc(4)
  len.writeUInt32BE(name.length)
  return Buffer.concat([len, name, Buffer.from(body)])
}

const ED = keyBlob('ssh-ed25519', 'key-one')
const ED_OTHER = keyBlob('ssh-ed25519', 'key-two')
const RSA = keyBlob('ssh-rsa', 'rsa-key')

const line = (host: string, blob: Buffer): string =>
  `${host} ${keyTypeOf(blob)} ${blob.toString('base64')}`

function hashed(host: string): string {
  const salt = randomBytes(20)
  const hash = createHmac('sha1', salt).update(host).digest('base64')
  return `|1|${salt.toString('base64')}|${hash}`
}

describe('known_hosts', () => {
  it('formats non-default ports like OpenSSH', () => {
    expect(hostPattern('1.2.3.4', 22)).toBe('1.2.3.4')
    expect(hostPattern('1.2.3.4', 2222)).toBe('[1.2.3.4]:2222')
  })

  it('reads key type and SHA256 fingerprint', () => {
    expect(keyTypeOf(ED)).toBe('ssh-ed25519')
    expect(fingerprint(ED)).toMatch(/^SHA256:[A-Za-z0-9+/]+$/)
  })

  it('matches plain, comma-separated and hashed hosts', () => {
    const entries = parseKnownHosts(
      [line('a.example,1.1.1.1', ED), line(hashed('[b.example]:2222'), ED), '# comment', ''].join(
        '\n'
      )
    )
    expect(checkHostKey(entries, '1.1.1.1', ED)).toBe('match')
    expect(checkHostKey(entries, '[b.example]:2222', ED)).toBe('match')
    expect(checkHostKey(entries, 'b.example', ED)).toBe('unknown')
  })

  it('reports changed only for the same key type', () => {
    const entries = parseKnownHosts(line('host', ED))
    expect(checkHostKey(entries, 'host', ED_OTHER)).toBe('changed')
    expect(checkHostKey(entries, 'host', RSA)).toBe('unknown')
  })

  it('treats revoked keys as changed and ignores cert authorities', () => {
    const entries = parseKnownHosts(
      [`@revoked ${line('*', ED)}`, `@cert-authority ${line('*', ED_OTHER)}`].join('\n')
    )
    expect(checkHostKey(entries, 'host', ED)).toBe('changed')
    expect(checkHostKey(entries, 'host', ED_OTHER)).toBe('unknown')
  })

  it('supports wildcards and negation', () => {
    const entries = parseKnownHosts(line('*.example,!bad.example', ED))
    expect(checkHostKey(entries, 'good.example', ED)).toBe('match')
    expect(checkHostKey(entries, 'bad.example', ED)).toBe('unknown')
  })

  it('replace() swaps only the matching entry and keeps a backup', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kh-'))
    const path = join(dir, 'known_hosts')
    writeFileSync(path, [line('host', ED), line('other', ED), line('host', RSA)].join('\n') + '\n')
    const file = new KnownHostsFile(path)

    file.replace('host', ED_OTHER)

    expect(file.check('host', ED_OTHER)).toBe('match')
    expect(file.check('host', ED)).toBe('changed')
    expect(file.check('host', RSA)).toBe('match')
    expect(file.check('other', ED)).toBe('match')
    expect(readFileSync(`${path}.old`, 'utf8')).toContain(ED.toString('base64'))
  })
})
