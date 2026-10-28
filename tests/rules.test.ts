import { describe, expect, it } from 'vitest'
import { runRules, type RulesInput } from '../src/main/audit/rules'
import {
  DEFAULT_THRESHOLDS,
  type ContainerInfo,
  type Finding,
  type RuleCode,
  type Snapshot
} from '../src/shared/audit'
import type { Server, Service } from '../src/shared/types'

const NOW = new Date('2026-10-17T00:00:00Z')
const daysAgo = (d: number): string => new Date(NOW.getTime() - d * 86_400_000).toISOString()

function server(id: number, monthlyCost = 5): Server {
  return {
    id,
    name: `s${id}`,
    provider: '',
    host: '',
    port: 22,
    username: '',
    sshAlias: '',
    identityFile: '',
    enpassItemUuid: '',
    monthlyCost,
    currency: 'EUR',
    billingDay: null,
    project: '',
    panelUrl: '',
    notes: '',
    createdAt: '',
    updatedAt: ''
  }
}

function service(
  serverId: number,
  name: string,
  kind: Service['kind'],
  port: number | null = null
): Service {
  return {
    id: 0,
    serverId,
    name,
    kind,
    url: '',
    port,
    description: '',
    enpassItemUuid: '',
    expected: true,
    notes: '',
    createdAt: '',
    updatedAt: ''
  }
}

function container(name: string, extra: Partial<ContainerInfo> = {}): ContainerInfo {
  return {
    id: name,
    name,
    image: `${name}:latest`,
    imageId: `sha256:${name}`,
    imageCreatedAt: daysAgo(10),
    state: 'running',
    startedAt: daysAgo(1),
    restartCount: 0,
    ports: [],
    labels: {},
    ...extra
  }
}

function snap(serverId: number, overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    serverId,
    takenAt: NOW.toISOString(),
    host: {
      hostname: 'h',
      os: '',
      kernel: '',
      uptimeSec: 1,
      nproc: 2,
      load: [1, 1, 1],
      memTotal: 100,
      memAvailable: 50,
      upgradable: 0
    },
    disks: [],
    containers: [],
    units: [],
    ports: [],
    vhosts: [],
    certs: [],
    cron: [],
    unavailable: [],
    ...overrides
  }
}

function run(
  snapshots: Record<number, Snapshot[]>,
  services: Service[] = [],
  servers: Server[] = Object.keys(snapshots).map((id) => server(Number(id)))
): Finding[] {
  const input: RulesInput = {
    servers,
    services,
    snapshots: new Map(Object.entries(snapshots).map(([id, list]) => [Number(id), list])),
    thresholds: DEFAULT_THRESHOLDS,
    now: NOW
  }
  return runRules(input)
}

const codes = (findings: Finding[], code: RuleCode): Finding[] =>
  findings.filter((f) => f.code === code)

describe('runRules', () => {
  it('stale_image: older than 180 days only', () => {
    const f = run({
      1: [
        snap(1, {
          containers: [
            container('old', { imageCreatedAt: daysAgo(181) }),
            container('fresh', { imageCreatedAt: daysAgo(179) })
          ]
        })
      ]
    })
    expect(codes(f, 'stale_image').map((x) => x.key)).toEqual(['stale_image:1:old'])
    expect(codes(f, 'stale_image')[0]).toMatchObject({
      source: 'rule',
      severity: 'info',
      serverId: 1
    })
  })

  it('no_traffic: only vhosts with a known access log mtime', () => {
    const f = run({
      1: [
        snap(1, {
          vhosts: [
            {
              domain: 'quiet.example.com',
              source: 'nginx',
              upstream: '',
              accessLogMtime: daysAgo(31)
            },
            {
              domain: 'busy.example.com',
              source: 'nginx',
              upstream: '',
              accessLogMtime: daysAgo(1)
            },
            { domain: 'unknown.example.com', source: 'nginx', upstream: '', accessLogMtime: null }
          ]
        })
      ]
    })
    expect(codes(f, 'no_traffic').map((x) => x.key)).toEqual(['no_traffic:1:quiet.example.com'])
  })

  it('duplicate: same image repository on two servers, ignoring infra images', () => {
    const f = run({
      1: [
        snap(1, {
          containers: [
            container('db', { image: 'postgres:16' }),
            container('t', { image: 'traefik:v3' })
          ]
        })
      ],
      2: [
        snap(2, {
          containers: [
            container('db2', { image: 'postgres:15' }),
            container('t', { image: 'traefik:v3' })
          ]
        })
      ]
    })
    const dup = codes(f, 'duplicate')
    expect(dup.map((x) => x.key)).toEqual(['duplicate:*:postgres'])
    expect(dup[0].serverId).toBeNull()
  })

  it('crashloop: restart count grew since the previous snapshot', () => {
    const prev = snap(1, {
      takenAt: daysAgo(1),
      containers: [container('app', { restartCount: 1 })]
    })
    const cur = snap(1, { containers: [container('app', { restartCount: 4 })] })
    const f = run({ 1: [cur, prev] })
    expect(codes(f, 'crashloop')).toHaveLength(1)
    expect(codes(f, 'crashloop')[0].severity).toBe('critical')
    expect(codes(run({ 1: [cur] }), 'crashloop')).toHaveLength(0)
    const restarting = snap(1, { containers: [container('app', { state: 'restarting' })] })
    expect(codes(run({ 1: [restarting] }), 'crashloop')).toHaveLength(1)
  })

  it('public_port: database port on a public address', () => {
    const f = run({
      1: [
        snap(1, {
          ports: [
            { address: '0.0.0.0', port: 5432, process: 'docker-proxy' },
            { address: '127.0.0.1', port: 6379, process: 'redis' },
            { address: '0.0.0.0', port: 80, process: 'nginx' }
          ]
        })
      ]
    })
    expect(codes(f, 'public_port').map((x) => x.key)).toEqual(['public_port:1:5432'])
  })

  it('unknown: unregistered container with a registry candidate', () => {
    const f = run(
      {
        1: [
          snap(1, {
            containers: [container('app'), container('blog')],
            units: [
              { name: 'mybot.service', active: 'active', sub: 'running', custom: true },
              { name: 'cron.service', active: 'active', sub: 'running', custom: false }
            ]
          })
        ]
      },
      [service(1, 'Blog', 'docker')]
    )
    const unknown = codes(f, 'unknown')
    expect(unknown.map((x) => x.key).sort()).toEqual(['unknown:1:app', 'unknown:1:mybot.service'])
    expect(unknown.find((x) => x.key === 'unknown:1:app')?.registryCandidate).toEqual({
      serverId: 1,
      name: 'app',
      kind: 'docker'
    })
  })

  it('missing: expected service is not running', () => {
    const f = run({ 1: [snap(1, { containers: [container('blog', { state: 'exited' })] })] }, [
      service(1, 'blog', 'docker'),
      service(1, 'misc', 'other')
    ])
    expect(codes(f, 'missing').map((x) => x.key)).toEqual(['missing:1:blog'])
    expect(codes(f, 'missing')[0].severity).toBe('critical')
  })

  it('missing: checks ports for "other" services and skips servers without a snapshot', () => {
    const f = run(
      { 1: [snap(1, { ports: [{ address: '0.0.0.0', port: 8080, process: 'java' }] })] },
      [
        service(1, 'api', 'other', 8080),
        service(1, 'admin', 'other', 9000),
        service(2, 'x', 'docker')
      ]
    )
    expect(codes(f, 'missing').map((x) => x.key)).toEqual(['missing:1:admin'])
  })

  it('idle_server: low RAM and CPU on a paid server', () => {
    const idle = (): Snapshot =>
      snap(1, { host: { ...snap(1).host!, memTotal: 100, memAvailable: 90, load: [0, 0, 0.05] } })
    expect(codes(run({ 1: [idle(), idle()] }), 'idle_server')).toHaveLength(1)
    expect(codes(run({ 1: [idle()] }, [], [server(1, 0)]), 'idle_server')).toHaveLength(0)
    expect(codes(run({ 1: [snap(1)] }), 'idle_server')).toHaveLength(0)
  })

  it('ssl_expiry: warning within 14 days, critical when expired', () => {
    const f = run({
      1: [
        snap(1, {
          certs: [
            { domain: 'soon.example.com', notAfter: daysAgo(-10), error: null },
            { domain: 'gone.example.com', notAfter: daysAgo(1), error: null },
            { domain: 'ok.example.com', notAfter: daysAgo(-60), error: null },
            { domain: 'down.example.com', notAfter: null, error: 'ECONNREFUSED' }
          ]
        })
      ]
    })
    const ssl = codes(f, 'ssl_expiry')
    expect(ssl.map((x) => [x.key, x.severity])).toEqual([
      ['ssl_expiry:1:soon.example.com', 'warning'],
      ['ssl_expiry:1:gone.example.com', 'critical']
    ])
  })

  it('disk_full: above 85% only', () => {
    const f = run({
      1: [
        snap(1, {
          disks: [
            { mount: '/', fs: 'ext4', size: 100, used: 86 },
            { mount: '/data', fs: 'ext4', size: 100, used: 85 }
          ]
        })
      ]
    })
    expect(codes(f, 'disk_full').map((x) => x.key)).toEqual(['disk_full:1:/'])
  })

  it('produces the same keys on repeated runs', () => {
    const snapshots = {
      1: [snap(1, { containers: [container('app', { imageCreatedAt: daysAgo(400) })] })]
    }
    expect(run(snapshots).map((f) => f.key)).toEqual(run(snapshots).map((f) => f.key))
  })
})

describe('runRules with unavailable sections', () => {
  it('does not report services missing when their section could not be collected', () => {
    const f = run({ 1: [snap(1, { unavailable: ['containers', 'units', 'ports'] })] }, [
      service(1, 'blog', 'docker'),
      service(1, 'worker', 'systemd'),
      service(1, 'api', 'other', 8080)
    ])
    expect(codes(f, 'missing')).toEqual([])
  })
})
