import { describe, expect, it } from 'vitest'
import {
  clipOutput,
  maskSecrets,
  sanitizeOutput,
  shq,
  validateRequest,
  type RawCommandRequest
} from '../src/main/audit/allowlist'
import type { Snapshot } from '../src/shared/audit'

const SNAP: Snapshot = {
  serverId: 1,
  takenAt: '2026-10-17T00:00:00.000Z',
  host: null,
  disks: [],
  containers: [
    {
      id: 'abc123',
      name: 'app',
      image: 'app:1',
      imageId: 'sha256:x',
      imageCreatedAt: null,
      state: 'running',
      startedAt: null,
      restartCount: 0,
      ports: [],
      labels: {}
    }
  ],
  units: [{ name: 'mybot.service', active: 'active', sub: 'running', custom: true }],
  ports: [],
  vhosts: [{ domain: 'app.example.com', source: 'traefik', upstream: 'app', accessLogMtime: null }],
  certs: [],
  cron: [],
  unavailable: []
}

const req = (command_id: string, args: Record<string, unknown>): RawCommandRequest => ({
  command_id,
  server_id: 1,
  args,
  reason: 'why'
})

const ok = (r: RawCommandRequest): string => {
  const v = validateRequest(r, SNAP)
  expect(v.error).toBeNull()
  return v.command!
}

const rejected = (r: RawCommandRequest, snapshot: Snapshot | null = SNAP): string => {
  const v = validateRequest(r, snapshot)
  expect(v.command).toBeNull()
  expect(v.error).toBeTruthy()
  return v.error!
}

describe('validateRequest', () => {
  it('renders allowed commands with quoted arguments', () => {
    expect(ok(req('docker_logs', { container: 'app', n: 50 }))).toBe("docker logs --tail 50 'app'")
    expect(ok(req('docker_logs', { container: 'app' }))).toBe("docker logs --tail 100 'app'")
    expect(ok(req('docker_inspect', { container: 'abc123' }))).toBe("docker inspect 'abc123'")
    expect(ok(req('systemctl_status', { unit: 'mybot.service' }))).toBe(
      "systemctl status --no-pager 'mybot.service'"
    )
    expect(ok(req('journal_tail', { unit: 'mybot', n: 200 }))).toBe(
      "journalctl -u 'mybot.service' -n 200 --no-pager"
    )
    expect(ok(req('read_config', { path: '/etc/nginx/sites-enabled/blog' }))).toBe(
      "head -c 65536 -- '/etc/nginx/sites-enabled/blog'"
    )
    expect(ok(req('read_config', { path: '/opt/app/docker-compose.yml' }))).toBe(
      "head -c 65536 -- '/opt/app/docker-compose.yml'"
    )
    expect(ok(req('list_dir', { path: '/opt' }))).toBe("ls -la -- '/opt'")
    expect(ok(req('list_dir', { path: '/home/deploy/apps/site' }))).toBe(
      "ls -la -- '/home/deploy/apps/site'"
    )
    expect(ok(req('http_head', { url: 'https://app.example.com/health' }))).toBe(
      "curl -sI --max-time 5 'https://app.example.com/health'"
    )
  })

  it('keeps the request metadata', () => {
    const v = validateRequest(req('docker_logs', { container: 'app' }), SNAP)
    expect(v).toMatchObject({ serverId: 1, commandId: 'docker_logs', reason: 'why' })
    expect(v.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('rejects unknown commands and containers', () => {
    expect(rejected(req('rm', {}))).toBe('Command is not in the allowlist')
    rejected(req('docker_logs', { container: 'other' }))
    rejected(req('docker_logs', { container: 'app; rm -rf /' }))
    rejected(req('docker_logs', { container: 'app', n: 10000 }))
    rejected(req('docker_logs', { container: 'app', n: 0 }))
    rejected(req('docker_logs', { container: 'app' }), null)
    rejected(req('systemctl_status', { unit: 'sshd.service' }))
  })

  it('rejects names that would be parsed as options', () => {
    const snap: Snapshot = {
      ...SNAP,
      containers: [{ ...SNAP.containers[0], name: '--privileged' }],
      units: [{ name: '-H.service', active: 'active', sub: 'running', custom: true }]
    }
    rejected(req('docker_logs', { container: '--privileged' }), snap)
    rejected(req('journal_tail', { unit: '-H.service' }), snap)
  })

  it('rejects paths outside the allowed prefixes', () => {
    rejected(req('read_config', { path: '/etc/nginx/../shadow' }))
    rejected(req('read_config', { path: '/etc/passwd' }))
    rejected(req('read_config', { path: 'etc/nginx/nginx.conf' }))
    rejected(req('read_config', { path: '/opt/app/.env' }))
    rejected(req('read_config', { path: '/etc/nginx/x\0y' }))
    rejected(req('list_dir', { path: '/root' }))
    rejected(req('list_dir', { path: '/home/deploy' }))
  })

  it('rejects URLs not served by this server', () => {
    rejected(req('http_head', { url: 'https://evil.com' }))
    rejected(req('http_head', { url: 'file:///etc/passwd' }))
    rejected(req('http_head', { url: 'https://app.example.com.evil.com/' }))
  })
})

describe('shq', () => {
  it('quotes single quotes', () => {
    expect(shq("a'b")).toBe(`'a'\\''b'`)
  })
})

describe('maskSecrets', () => {
  it('hides passwords, tokens, keys and URL credentials', () => {
    const text = [
      'DB_PASSWORD=hunter2',
      'api_token: abcdef',
      'Authorization: Bearer xyz789',
      'postgres://u:p4ss@db/x',
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      'AAAAB3Nza',
      '-----END OPENSSH PRIVATE KEY-----',
      'PORT=8080'
    ].join('\n')
    const masked = maskSecrets(text)
    for (const secret of ['hunter2', 'abcdef', 'xyz789', 'p4ss', 'AAAAB3Nza']) {
      expect(masked).not.toContain(secret)
    }
    expect(masked).toContain('PORT=8080')
    expect(masked).toContain('[key hidden]')
  })
})

describe('clipOutput', () => {
  it('truncates long output and says how much was cut', () => {
    const clipped = clipOutput('x'.repeat(25000))
    expect(clipped.length).toBeLessThanOrEqual(20100)
    expect(clipped).toContain('clipped 5000')
    expect(clipOutput('short')).toBe('short')
  })
})

describe('maskSecrets: common credential shapes', () => {
  it('hides short password names, *_KEY, DSNs, live keys, mysql -p and htpasswd hashes', () => {
    const text = [
      'DB_PASS=pw1',
      'APP_KEY=base64:appkey2',
      'STRIPE=sk_live_stripe3',
      'SENTRY_DSN=https://dsnkey4@o1.ingest.sentry.io/1',
      '0 3 * * * mysqldump -uroot -pmysql5 db > /b.sql',
      '"traefik.http.middlewares.a.basicauth.users": "admin:$apr1$salt$hash6"',
      'PORT=8080'
    ].join('\n')
    const masked = maskSecrets(text)
    for (const secret of ['pw1', 'appkey2', 'stripe3', 'dsnkey4', 'mysql5', 'hash6']) {
      expect(masked).not.toContain(secret)
    }
    expect(masked).toContain('PORT=8080')
  })

  it('keeps JSON quoting intact when masking a value', () => {
    expect(maskSecrets('{"Env": ["DB_PASSWORD=hunter2", "PORT=1"]}')).toBe(
      '{"Env": ["DB_PASSWORD=***", "PORT=1"]}'
    )
  })
})

describe('sanitizeOutput', () => {
  it('keeps only variable names from docker inspect Env', () => {
    const inspect = JSON.stringify([
      { Name: '/app', Config: { Env: ['WEIRD_VALUE=opaque123', 'PORT=80'], Image: 'app:1' } }
    ])
    const out = sanitizeOutput('docker_inspect', inspect)
    expect(out).not.toContain('opaque123')
    expect(out).toContain('WEIRD_VALUE=***')
    expect(out).toContain('app:1')
  })

  it('passes other output through maskSecrets', () => {
    expect(sanitizeOutput('docker_logs', 'TOKEN=abc')).toBe('TOKEN=***')
    expect(sanitizeOutput('docker_inspect', 'not json')).toBe('not json')
  })
})
