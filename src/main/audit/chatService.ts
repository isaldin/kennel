import type { ChatMessage, CommandRequest, FindingChat } from '../../shared/audit'
import type { Server } from '../../shared/types'
import type { Repo } from '../repo'
import type { ExecResult } from '../sshConnect'
import { executeRequest, validateRequest } from './allowlist'
import { buildFollowUpPrompt } from './analyzer'
import type { AuditRepo } from './auditRepo'
import { MAX_COMMAND_ROUNDS } from './auditService'
import { buildChatPrompt, type ChatReply } from './chat'
import type { ChatRepo } from './chatRepo'
import {
  ANSWER_TIMEOUT_MS,
  Stopped,
  abortable,
  errorMessage,
  waitForAnswer,
  type Controlled
} from './control'

export interface ChatDeps {
  repo: Repo
  audit: AuditRepo
  chats: ChatRepo
  exec(server: Server, command: string): Promise<ExecResult>
  claude(prompt: string, resume?: string, signal?: AbortSignal): Promise<ChatReply>
  emit(chat: FindingChat): void
  now(): Date
  answerTimeoutMs?: number
}

const FOLLOW_UP = 'Ответь пользователю с учётом этих данных.'

interface ActiveChat extends Controlled {
  promise: Promise<void>
}

const chatId = (serverId: number, findingKey: string): string => `${serverId}\n${findingKey}`

/** Conversations with Claude about single audit findings. Claude only reads; the user acts. */
export class ChatService {
  private readonly active = new Map<string, ActiveChat>()

  constructor(private readonly deps: ChatDeps) {}

  get(serverId: number, findingKey: string): FindingChat | null {
    return this.deps.chats.get(serverId, findingKey)
  }

  /** Adds the question and starts Claude on it in the background. */
  send(serverId: number, findingKey: string, text: string): FindingChat {
    const id = chatId(serverId, findingKey)
    if (this.active.has(id)) throw new Error('Claude ещё отвечает')
    const server = this.deps.repo.listServers().find((s) => s.id === serverId)
    if (!server) throw new Error(`Сервер ${serverId} не найден`)
    const finding = this.deps.audit.latestRun(serverId)?.findings.find((f) => f.key === findingKey)
    let chat = this.deps.chats.get(serverId, findingKey)
    if (!chat && !finding) throw new Error('Проблема не найдена в последнем аудите')
    chat ??= {
      serverId,
      findingKey,
      title: finding!.title,
      sessionId: null,
      messages: [],
      status: 'idle',
      round: 0,
      pendingCommands: [],
      error: null,
      startedAt: null
    }

    const prompt =
      chat.sessionId || !finding
        ? text
        : buildChatPrompt({
            server,
            services: this.deps.repo.listServices(serverId),
            snapshot: this.deps.audit.recentSnapshots(serverId, 1)[0] ?? null,
            finding,
            decisions: this.deps.audit.listDecisions(),
            question: text
          })
    chat.messages.push(this.message('user', text))
    chat.status = 'thinking'
    chat.round = 0
    chat.error = null
    chat.startedAt = this.deps.now().toISOString()
    this.save(chat)

    const entry: ActiveChat = {
      controller: new AbortController(),
      answer: null,
      promise: Promise.resolve()
    }
    this.active.set(id, entry)
    entry.promise = this.converse(chat, server, prompt, entry).finally(() => this.active.delete(id))
    return structuredClone(chat)
  }

  stopAll(): void {
    for (const entry of this.active.values()) entry.controller.abort()
  }

  stop(serverId: number, findingKey: string): void {
    this.active.get(chatId(serverId, findingKey))?.controller.abort()
  }

  answerCommands(serverId: number, findingKey: string, approvedIds: string[]): void {
    this.active.get(chatId(serverId, findingKey))?.answer?.(approvedIds)
  }

  /** Resolves when every pending answer has finished. */
  async done(): Promise<void> {
    await Promise.all([...this.active.values()].map((a) => a.promise))
  }

  private message(role: ChatMessage['role'], text: string): ChatMessage {
    return { role, text, at: this.deps.now().toISOString() }
  }

  private save(chat: FindingChat): void {
    this.deps.chats.save(chat)
    this.deps.emit(structuredClone(chat))
  }

  private async converse(
    chat: FindingChat,
    server: Server,
    prompt: string,
    entry: ActiveChat
  ): Promise<void> {
    const signal = entry.controller.signal
    const claude = (text: string): Promise<ChatReply> =>
      abortable(this.deps.claude(text, chat.sessionId ?? undefined, signal), signal)
    const take = (result: ChatReply): void => {
      chat.sessionId = result.sessionId
      if (result.output.reply.trim()) {
        chat.messages.push(this.message('assistant', result.output.reply))
      }
      this.save(chat)
    }

    try {
      let result = await claude(prompt)
      take(result)
      while (result.output.commandRequests.length > 0 && chat.round < MAX_COMMAND_ROUNDS) {
        const snapshot = this.deps.audit.recentSnapshots(server.id, 1)[0] ?? null
        const requests = result.output.commandRequests.map((raw) =>
          validateRequest(raw, raw.server_id === server.id ? snapshot : null)
        )
        chat.pendingCommands = requests
        chat.status = 'awaiting_confirmation'
        this.save(chat)
        const approved = new Set(
          await waitForAnswer(entry, this.deps.answerTimeoutMs ?? ANSWER_TIMEOUT_MS)
        )
        chat.pendingCommands = []
        chat.status = 'thinking'

        const results: { request: CommandRequest; declined: boolean; output: string | null }[] = []
        for (const request of requests) {
          const runIt = request.command !== null && approved.has(request.id)
          results.push({
            request,
            declined: !request.error && !approved.has(request.id),
            output: runIt
              ? await abortable(
                  executeRequest(request, (command) => this.deps.exec(server, command)),
                  signal
                )
              : null
          })
        }
        chat.messages.push({
          ...this.message('commands', ''),
          commands: results.map(({ request, output }) => ({
            command: request.command ?? `${request.commandId} ${JSON.stringify(request.args)}`,
            status: request.error ? 'rejected' : output !== null ? 'ran' : 'declined'
          }))
        })
        this.save(chat)
        chat.round++
        result = await claude(
          buildFollowUpPrompt(results, chat.round >= MAX_COMMAND_ROUNDS, FOLLOW_UP)
        )
        take(result)
      }
    } catch (err) {
      chat.error = err instanceof Stopped ? err.message : errorMessage(err)
    }
    chat.status = 'idle'
    chat.pendingCommands = []
    chat.startedAt = null
    this.save(chat)
  }
}
