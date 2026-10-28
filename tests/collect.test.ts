import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync } from 'fs'
import type { AddressInfo } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import { createServer, type Server as TlsServer } from 'tls'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkCerts, parseCollectOutput, snapshotDomains } from '../src/main/audit/collect'

const RAW = readFileSync(join(__dirname, 'fixtures/collect-output.txt'), 'utf8')
const TAKEN = '2026-10-17T00:00:00.000Z'

describe('parseCollectOutput', () => {
  const s = parseCollectOutput(7, TAKEN, RAW)

  it('parses host info with memory in bytes', () => {
    expect(s.serverId).toBe(7)
    expect(s.host).toMatchObject({
      hostname: 'vps-1',
      os: 'Ubuntu 24.04.1 LTS',
      nproc: 2,
      load: [0.08, 0.12, 0.1],
      memTotal: 4014080 * 1024,
      memAvailable: 3010560 * 1024,
      upgradable: 12
    })
  })

  it('parses disks', () => {
    expect(s.disks[0]).toEqual({ mount: '/', fs: 'ext4', size: 84145745920, used: 72364793856 })
  })

  it('parses containers with image creation dates', () => {
    expect(s.containers).toHaveLength(2)
    expect(s.containers[0]).toMatchObject({
      id: 'aaa111',
      name: 'app',
      image: 'ghcr.io/me/app:latest',
      imageCreatedAt: '2026-03-01T12:00:00.123Z',
      state: 'running',
      restartCount: 4
    })
    expect(s.containers[1].ports).toEqual(['0.0.0.0:5432->5432/tcp'])
  })

  it('marks units installed in /etc/systemd/system as custom', () => {
    expect(s.units.find((u) => u.name === 'mybot.service')).toMatchObject({
      active: 'failed',
      custom: true
    })
    expect(s.units.find((u) => u.name === 'nginx.service')?.custom).toBe(false)
  })

  it('parses listening ports', () => {
    expect(s.ports).toContainEqual({ address: '0.0.0.0', port: 5432, process: 'docker-proxy' })
    expect(s.ports).toContainEqual({ address: '::', port: 22, process: 'sshd' })
    expect(s.ports).toContainEqual({ address: '127.0.0.53', port: 53, process: 'systemd-resolve' })
  })

  it('extracts vhosts from traefik labels and nginx', () => {
    expect(s.vhosts).toContainEqual({
      domain: 'app.example.com',
      source: 'traefik',
      upstream: 'app',
      accessLogMtime: null
    })
    expect(s.vhosts).toContainEqual({
      domain: 'blog.example.com',
      source: 'nginx',
      upstream: 'http://127.0.0.1:2368',
      accessLogMtime: new Date(1755000000 * 1000).toISOString()
    })
    expect(s.vhosts.find((v) => v.domain === 'api.example.com')?.accessLogMtime).toBeNull()
    expect(s.vhosts.some((v) => v.domain === '_')).toBe(false)
    expect(snapshotDomains(s)).toEqual(
      expect.arrayContaining(['app.example.com', 'www.app.example.com', 'blog.example.com'])
    )
  })

  it('records failed sections as unavailable', () => {
    expect(s.unavailable).toEqual(['caddy'])
    expect(s.cron).toEqual(['0 3 * * * /usr/local/bin/backup.sh'])
  })

  it('extracts caddy site blocks', () => {
    const caddy = [
      '@@begin caddy',
      '{',
      '  email me@example.com',
      '}',
      'shop.example.com, https://www.shop.example.com {',
      '  reverse_proxy localhost:8000',
      '}',
      ':8080 {',
      '  respond "ok"',
      '}',
      '@@end caddy 0'
    ].join('\n')
    expect(parseCollectOutput(1, TAKEN, caddy).vhosts).toEqual([
      {
        domain: 'shop.example.com',
        source: 'caddy',
        upstream: 'localhost:8000',
        accessLogMtime: null
      },
      {
        domain: 'www.shop.example.com',
        source: 'caddy',
        upstream: 'localhost:8000',
        accessLogMtime: null
      }
    ])
  })

  it('treats a truncated section as unavailable instead of throwing', () => {
    const cut = RAW.slice(0, RAW.indexOf('@@end images'))
    const partial = parseCollectOutput(7, TAKEN, cut)
    expect(partial.unavailable).toContain('images')
    expect(partial.containers).toHaveLength(2)
    expect(partial.containers[0].imageCreatedAt).toBeNull()
  })
})

describe('checkCerts', () => {
  let server: TlsServer
  let port: number

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cert-'))
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '10',
        '-subj',
        '/CN=localhost',
        '-keyout',
        join(dir, 'key.pem'),
        '-out',
        join(dir, 'cert.pem')
      ],
      { stdio: 'ignore' }
    )
    server = createServer({
      key: readFileSync(join(dir, 'key.pem')),
      cert: readFileSync(join(dir, 'cert.pem'))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(() => server.close())

  it('reads the certificate expiry date', async () => {
    const [cert] = await checkCerts([`localhost:${port}`])
    expect(cert.error).toBeNull()
    const days = (Date.parse(cert.notAfter!) - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(9)
    expect(days).toBeLessThanOrEqual(10)
  })

  it('reports an error for an unreachable domain', async () => {
    const [cert] = await checkCerts(['nonexistent.invalid'], 2000)
    expect(cert.notAfter).toBeNull()
    expect(cert.error).not.toBeNull()
  })
})
