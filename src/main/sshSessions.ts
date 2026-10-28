import { randomUUID } from 'crypto'
import { join } from 'path'
import { StringDecoder } from 'string_decoder'
import { Client, type ClientChannel } from 'ssh2'
import type { HostKeyPrompt, Server, SessionEvent } from '../shared/types'
import { KnownHostsFile } from './knownHosts'
import { SSH_DIR } from './sshConfig'
import { connectConfig, resolveTarget } from './sshConnect'

export interface SessionCallbacks {
  emit(event: SessionEvent): void
  askHostKey(prompt: Omit<HostKeyPrompt, 'promptId'>): Promise<boolean>
  /** Password from the linked Enpass item, or null when none is linked/unlocked. */
  password(server: Server): string | null
}

interface Session {
  client: Client
  stream: ClientChannel | null
}

export class SshSessions {
  private readonly sessions = new Map<string, Session>()
  private readonly knownHosts = new KnownHostsFile(join(SSH_DIR, 'known_hosts'))

  constructor(private readonly callbacks: SessionCallbacks) {}

  open(server: Server, cols: number, rows: number): string {
    const sessionId = randomUUID()
    const target = resolveTarget(server)
    const client = new Client()
    const session: Session = { client, stream: null }
    this.sessions.set(sessionId, session)
    const emit = (e: Omit<SessionEvent, 'sessionId'>): void =>
      this.callbacks.emit({ sessionId, ...e })

    let password: string | null = null
    try {
      password = this.callbacks.password(server)
    } catch (err) {
      emit({ type: 'status', message: `Enpass: ${(err as Error).message}` })
    }

    emit({
      type: 'status',
      message: `Connecting to ${target.username}@${target.host}:${target.port}…`
    })

    client
      .on('ready', () => {
        emit({ type: 'status', message: 'Connected' })
        client.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
          if (err) {
            emit({ type: 'error', message: err.message })
            client.end()
            return
          }
          session.stream = stream
          const decoder = new StringDecoder('utf8')
          stream.on('data', (chunk: Buffer) => emit({ type: 'data', data: decoder.write(chunk) }))
          stream.stderr.on('data', (chunk: Buffer) =>
            emit({ type: 'data', data: decoder.write(chunk) })
          )
          stream.on('close', () => client.end())
        })
      })
      .on('error', (err) => emit({ type: 'error', message: err.message }))
      .on('close', () => {
        this.sessions.delete(sessionId)
        emit({ type: 'closed' })
      })
      .connect(
        connectConfig(server, {
          policy: 'ask',
          knownHosts: this.knownHosts,
          askHostKey: (prompt) => this.callbacks.askHostKey(prompt),
          password,
          onAuthFailed: (message) => emit({ type: 'error', message })
        })
      )

    return sessionId
  }

  write(sessionId: string, data: string): void {
    this.sessions.get(sessionId)?.stream?.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.sessions.get(sessionId)?.stream?.setWindow(rows, cols, 0, 0)
  }

  close(sessionId: string): void {
    this.sessions.get(sessionId)?.client.end()
  }

  closeAll(): void {
    for (const { client } of this.sessions.values()) client.end()
  }
}
