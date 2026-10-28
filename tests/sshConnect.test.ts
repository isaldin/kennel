import { mkdtempSync } from 'fs'
import type { AddressInfo } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import { Server as SshServer, utils } from 'ssh2'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { KnownHostsFile, hostPattern } from '../src/main/knownHosts'
import { execOnServer, type ConnectOptions } from '../src/main/sshConnect'
import type { Server } from '../src/shared/types'

const hostKey = utils.generateKeyPairSync('ed25519')
const hostKeyBlob = (
  utils.parseKey(hostKey.public) as ReturnType<typeof utils.parseKey> & {
    getPublicSSH(): Buffer
  }
).getPublicSSH()

let sshd: SshServer
let port: number
let savedAgent: string | undefined

beforeAll(async () => {
  savedAgent = process.env.SSH_AUTH_SOCK
  delete process.env.SSH_AUTH_SOCK
  sshd = new SshServer({ hostKeys: [hostKey.private] }, (client) => {
    client
      .on('authentication', (ctx) => {
        if (ctx.method === 'password' && ctx.password === 'pw') ctx.accept()
        else ctx.reject(['password'])
      })
      .on('ready', () => {
        client.on('session', (acceptSession) => {
          acceptSession().on('exec', (accept, _reject, info) => {
            const stream = accept()
            if (info.command === 'sleep') return // never answers
            let input = ''
            stream.on('data', (d: Buffer) => (input += d.toString()))
            stream.on('end', () => {
              stream.write(`echo:${info.command}\n${input}`)
              stream.exit(3)
              stream.end()
            })
          })
        })
      })
      .on('error', () => {})
  })
  await new Promise<void>((resolve) => sshd.listen(0, '127.0.0.1', resolve))
  port = (sshd.address() as AddressInfo).port
})

afterAll(() => {
  sshd.close()
  if (savedAgent) process.env.SSH_AUTH_SOCK = savedAgent
})

const server = (): Server => ({
  id: 1,
  name: 'test',
  provider: '',
  host: '127.0.0.1',
  port,
  username: 'u',
  sshAlias: '',
  identityFile: '/nonexistent/key',
  enpassItemUuid: '',
  monthlyCost: 0,
  currency: 'USD',
  billingDay: null,
  project: '',
  panelUrl: '',
  notes: '',
  createdAt: '',
  updatedAt: ''
})

function strictOptions(): ConnectOptions & { knownHosts: KnownHostsFile } {
  const knownHosts = new KnownHostsFile(join(mkdtempSync(join(tmpdir(), 'kh-')), 'known_hosts'))
  return { policy: 'strict', knownHosts, password: 'pw' }
}

describe('execOnServer', () => {
  it('refuses an unknown host key under the strict policy', async () => {
    await expect(execOnServer(server(), 'uptime', strictOptions())).rejects.toThrow(
      /Host key not verified/
    )
  })

  it('runs a command and returns stdout and the exit code', async () => {
    const opts = strictOptions()
    opts.knownHosts.add(hostPattern('127.0.0.1', port), hostKeyBlob)
    const result = await execOnServer(server(), 'uptime', opts)
    expect(result).toMatchObject({ stdout: 'echo:uptime\n', code: 3 })
  })

  it('passes stdin to the command', async () => {
    const opts = strictOptions()
    opts.knownHosts.add(hostPattern('127.0.0.1', port), hostKeyBlob)
    const result = await execOnServer(server(), 'bash -s', { ...opts, stdin: 'abc' })
    expect(result.stdout).toBe('echo:bash -s\nabc')
  })

  it('times out a command that never finishes', async () => {
    const opts = strictOptions()
    opts.knownHosts.add(hostPattern('127.0.0.1', port), hostKeyBlob)
    await expect(execOnServer(server(), 'sleep', { ...opts, timeoutMs: 200 })).rejects.toThrow(
      /timed out/
    )
  })
})
