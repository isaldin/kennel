import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { StringDecoder } from 'string_decoder'
import { Client, utils, type AnyAuthMethod, type ConnectConfig, type NextAuthHandler } from 'ssh2'
import type { HostKeyPrompt, Server } from '../shared/types'
import { KnownHostsFile, fingerprint, hostPattern, keyTypeOf } from './knownHosts'
import { SSH_DIR, expandHome, resolveAlias } from './sshConfig'

const DEFAULT_IDENTITIES = ['id_ed25519', 'id_ecdsa', 'id_rsa'].map((name) => join(SSH_DIR, name))

export const HOST_KEY_NOT_VERIFIED = 'Host key not verified — connect once from the terminal'

export interface ConnectTarget {
  host: string
  port: number
  username: string
  identityFiles: string[]
}

export function resolveTarget(server: Server): ConnectTarget {
  if (server.sshAlias) {
    const resolved = resolveAlias(server.sshAlias)
    return {
      host: server.host || resolved.hostName,
      port: server.host ? server.port : resolved.port,
      username: server.username || resolved.user || 'root',
      identityFiles: server.identityFile
        ? [expandHome(server.identityFile)]
        : resolved.identityFiles
    }
  }
  return {
    host: server.host,
    port: server.port || 22,
    username: server.username || 'root',
    identityFiles: server.identityFile ? [expandHome(server.identityFile)] : DEFAULT_IDENTITIES
  }
}

/** Unencrypted private keys only; passphrase-protected ones are expected to be in ssh-agent. */
function loadPlainKeys(paths: string[]): Buffer[] {
  const keys: Buffer[] = []
  for (const path of paths) {
    if (!existsSync(path)) continue
    const data = readFileSync(path)
    const parsed = utils.parseKey(data)
    if (!(parsed instanceof Error)) keys.push(data)
  }
  return keys
}

// ssh2 accepts `false` to stop authentication, but its typings omit it.
const stopAuth = (next: NextAuthHandler): void => (next as unknown as (v: false) => void)(false)

/** 'ask' prompts the user on an unknown or changed key; 'strict' accepts only a known_hosts match. */
export type HostKeyPolicy = 'ask' | 'strict'

export interface ConnectOptions {
  policy: HostKeyPolicy
  knownHosts: KnownHostsFile
  askHostKey?: (prompt: Omit<HostKeyPrompt, 'promptId'>) => Promise<boolean>
  /** Password from the linked Enpass item, or null. */
  password: string | null
  readyTimeoutMs?: number
  /** Called with a user-facing reason when every auth method has been tried. */
  onAuthFailed?: (message: string) => void
  /** Called when the host key is rejected (strict mismatch or the user declined). */
  onHostKeyRejected?: () => void
}

export interface ExecResult {
  stdout: string
  stderr: string
  code: number | null
}

function authQueue(target: ConnectTarget, password: string | null): AnyAuthMethod[] {
  const queue: AnyAuthMethod[] = []
  if (process.env.SSH_AUTH_SOCK) {
    queue.push({ type: 'agent', username: target.username, agent: process.env.SSH_AUTH_SOCK })
  }
  for (const key of loadPlainKeys(target.identityFiles)) {
    queue.push({ type: 'publickey', username: target.username, key })
  }
  if (password) {
    queue.push({ type: 'password', username: target.username, password })
    queue.push({
      type: 'keyboard-interactive',
      username: target.username,
      prompt: (_name, _instructions, _lang, prompts, finish) => finish(prompts.map(() => password))
    })
  }
  return queue
}

async function verifyHostKey(
  target: ConnectTarget,
  key: Buffer,
  opts: ConnectOptions
): Promise<boolean> {
  const host = hostPattern(target.host, target.port)
  const status = opts.knownHosts.check(host, key)
  if (status === 'match') return true
  if (opts.policy === 'strict' || !opts.askHostKey) return false
  const accepted = await opts.askHostKey({
    host: target.host,
    port: target.port,
    keyType: keyTypeOf(key),
    fingerprint: fingerprint(key),
    kind: status
  })
  if (!accepted) return false
  if (status === 'changed') opts.knownHosts.replace(host, key)
  else opts.knownHosts.add(host, key)
  return true
}

/** ssh2 connect config with our auth order (agent → keys → Enpass password) and host key check. */
export function connectConfig(server: Server, opts: ConnectOptions): ConnectConfig {
  const target = resolveTarget(server)
  const queue = authQueue(target, opts.password)
  return {
    host: target.host,
    port: target.port,
    username: target.username,
    readyTimeout: opts.readyTimeoutMs ?? 20000,
    keepaliveInterval: 30000,
    hostVerifier: (key: Buffer, verify: (valid: boolean) => void) => {
      verifyHostKey(target, key, opts).then(
        (ok) => {
          if (!ok) opts.onHostKeyRejected?.()
          verify(ok)
        },
        () => {
          opts.onHostKeyRejected?.()
          verify(false)
        }
      )
    },
    authHandler: (methodsLeft, _partial, next) => {
      while (queue.length) {
        const method = queue.shift()!
        if (!methodsLeft || methodsLeft.includes(method.type)) return next(method)
      }
      opts.onAuthFailed?.(
        opts.password
          ? 'All authentication methods failed'
          : 'No working key. Add it to ssh-agent (ssh-add --apple-use-keychain <key>) or link an Enpass item with the password'
      )
      return stopAuth(next)
    }
  }
}

export function connect(server: Server, opts: ConnectOptions): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client()
    let reason: string | null = null
    client
      .on('ready', () => resolve(client))
      .on('error', (err) => reject(new Error(reason ?? err.message)))
      .connect(
        connectConfig(server, {
          ...opts,
          onHostKeyRejected: () => {
            reason = HOST_KEY_NOT_VERIFIED
            opts.onHostKeyRejected?.()
          },
          onAuthFailed: (message) => {
            reason = message
            opts.onAuthFailed?.(message)
          }
        })
      )
  })
}

export function execCommand(
  client: Client,
  command: string,
  opts: { stdin?: string; timeoutMs?: number; maxBytes?: number } = {}
): Promise<ExecResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000
  const maxBytes = opts.maxBytes ?? 5_000_000
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) return reject(err)
      const out = new StringDecoder('utf8')
      const errOut = new StringDecoder('utf8')
      let stdout = ''
      let stderr = ''
      let bytes = 0
      let code: number | null = null
      const timer = setTimeout(() => {
        stream.close()
        reject(new Error(`Command timed out after ${timeoutMs} ms`))
      }, timeoutMs)
      stream.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes <= maxBytes) stdout += out.write(chunk)
      })
      stream.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < 65536) stderr += errOut.write(chunk)
      })
      stream.on('exit', (exitCode: number | null) => (code = exitCode))
      stream.on('close', () => {
        clearTimeout(timer)
        resolve({ stdout: stdout + out.end(), stderr: stderr + errOut.end(), code })
      })
      if (opts.stdin !== undefined) stream.end(opts.stdin)
      else stream.end()
    })
  })
}

/** Connects, runs one command and disconnects. */
export async function execOnServer(
  server: Server,
  command: string,
  opts: ConnectOptions & { stdin?: string; timeoutMs?: number }
): Promise<ExecResult> {
  const client = await connect(server, opts)
  try {
    return await execCommand(client, command, { stdin: opts.stdin, timeoutMs: opts.timeoutMs })
  } finally {
    client.end()
  }
}
