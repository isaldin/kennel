import { useEffect, useRef, useState } from 'react'
import type { ChatMessage, FindingChat } from '../../../shared/audit'
import type { MessageKey } from '../../../shared/i18n'
import type { Server } from '../../../shared/types'
import { errorText } from '../lib/audit'
import { cleanError } from '../lib/errors'
import { useT } from '../lib/prefsContext'
import { CommandConfirmDialog } from './CommandConfirmDialog'

interface Props {
  server: Server
  findingKey: string
  findingTitle: string
  /** Kept mounted while another chat is shown, so its state and timers keep running. */
  hidden: boolean
  /** Whether this chat already has its own terminal tab. */
  terminalOpen: boolean
  onOpenTerminal(): void
  onClose(): void
}

const STARTERS: MessageKey[] = ['chat.starter.what', 'chat.starter.fix', 'chat.starter.remove']

const COMMAND_STATUS: Record<NonNullable<ChatMessage['commands']>[number]['status'], MessageKey> = {
  ran: 'chat.command.ran',
  declined: 'chat.command.declined',
  rejected: 'chat.command.rejected'
}

/** Splits a reply into prose and fenced code blocks; code blocks get a copy button. */
function splitFences(text: string): { code: boolean; text: string }[] {
  const parts: { code: boolean; text: string }[] = []
  const fence = /```[\w-]*\n?([\s\S]*?)```/g
  let last = 0
  for (const m of text.matchAll(fence)) {
    if (m.index > last) parts.push({ code: false, text: text.slice(last, m.index) })
    parts.push({ code: true, text: m[1].replace(/\n$/, '') })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ code: false, text: text.slice(last) })
  return parts.filter((p) => p.text.trim())
}

function CodeBlock({ text }: { text: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const t = useT()
  const copy = async (): Promise<void> => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="chat-code">
      <pre className="mono">{text}</pre>
      <button className="ghost small" onClick={copy}>
        {copied ? t('chat.copied') : t('chat.copy')}
      </button>
    </div>
  )
}

/** Plain text with `inline code` set in monospace. */
function Prose({ text }: { text: string }): React.JSX.Element {
  return (
    <p>
      {text
        .trim()
        .split(/(`[^`\n]+`)/)
        .map((chunk, i) =>
          /^`[^`]+`$/.test(chunk) ? (
            <code key={i} className="mono">
              {chunk.slice(1, -1)}
            </code>
          ) : (
            chunk
          )
        )}
    </p>
  )
}

function Message({ message }: { message: ChatMessage }): React.JSX.Element {
  const t = useT()
  if (message.role === 'commands') {
    return (
      <div className="chat-commands small">
        {message.commands?.map((c, i) => (
          <div key={i}>
            <code className="mono">{c.command}</code>{' '}
            <span className="muted">— {t(COMMAND_STATUS[c.status])}</span>
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className={`chat-message ${message.role}`}>
      {message.role === 'user'
        ? message.text
        : splitFences(message.text).map((part, i) =>
            part.code ? <CodeBlock key={i} text={part.text} /> : <Prose key={i} text={part.text} />
          )}
    </div>
  )
}

const formatElapsed = (ms: number): string => {
  const sec = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

export function ChatDrawer({
  server,
  findingKey,
  findingTitle,
  hidden,
  terminalOpen,
  onOpenTerminal,
  onClose
}: Props): React.JSX.Element {
  const [chat, setChat] = useState<FindingChat | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [answered, setAnswered] = useState<string[]>([])
  const [now, setNow] = useState(() => Date.now())
  const bottom = useRef<HTMLDivElement>(null)
  const busy = chat !== null && chat.status !== 'idle'
  const t = useT()

  useEffect(() => {
    window.api.chat.get(server.id, findingKey).then(setChat)
    return window.api.chat.onUpdate((c) => {
      if (c.serverId === server.id && c.findingKey === findingKey) setChat(c)
    })
  }, [server.id, findingKey])

  useEffect(() => {
    if (!busy || hidden) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [busy, hidden])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [chat?.messages.length, chat?.status])

  const send = async (text: string): Promise<void> => {
    if (!text.trim() || busy) return
    setError('')
    try {
      setChat(await window.api.chat.send(server.id, findingKey, text.trim()))
      setDraft('')
    } catch (err) {
      setError(cleanError(err))
    }
  }

  const round = chat ? `${chat.findingKey}:${chat.messages.length}:${chat.round}` : ''
  const confirming =
    chat?.status === 'awaiting_confirmation' && !answered.includes(round) ? chat : null

  return (
    <aside className="chat-panel" style={hidden ? { display: 'none' } : undefined}>
      <header className="chat-header">
        <div>
          <div className="muted small">{t('chat.header', { server: server.name })}</div>
          <div className="chat-title">{findingTitle}</div>
        </div>
        <div className="actions">
          <button
            title={terminalOpen ? t('chat.toTerminalHint') : t('chat.openTerminalHint')}
            onClick={onOpenTerminal}
          >
            {terminalOpen ? t('chat.toTerminal') : t('chat.openTerminal')}
          </button>
          <button className="ghost" title={t('common.close')} onClick={onClose}>
            ✕
          </button>
        </div>
      </header>

      <div className="chat-body">
        {!chat?.messages.length && (
          <div className="chat-starters">
            <p className="muted small">{t('chat.intro')}</p>
            {STARTERS.map((key) => (
              <button key={key} onClick={() => send(t(key))} disabled={busy}>
                {t(key)}
              </button>
            ))}
          </div>
        )}
        {chat?.messages.map((m, i) => (
          <Message key={i} message={m} />
        ))}
        {busy && chat && (
          <div className="chat-thinking muted small">
            {chat.status === 'awaiting_confirmation'
              ? t('chat.awaitingConfirmation')
              : t('chat.thinking')}{' '}
            {chat.startedAt && formatElapsed(now - Date.parse(chat.startedAt))}{' '}
            <button
              className="ghost small"
              onClick={() => window.api.chat.stop(server.id, findingKey)}
            >
              {t('chat.stop')}
            </button>
          </div>
        )}
        {chat?.error && !busy && <div className="notice">{errorText(chat.error, t)}</div>}
        {error && <p className="error">{error}</p>}
        <div ref={bottom} />
      </div>

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault()
          send(draft)
        }}
      >
        <textarea
          rows={3}
          placeholder={t('chat.placeholder')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send(draft)
            }
          }}
        />
        <button className="primary" type="submit" disabled={busy || !draft.trim()}>
          {t('chat.send')}
        </button>
      </form>

      {confirming && (
        <CommandConfirmDialog
          key={round}
          commands={confirming.pendingCommands}
          round={confirming.round}
          servers={[server]}
          onAnswer={(ids) => {
            setAnswered((list) => [...list, round])
            window.api.chat.answerCommands(server.id, findingKey, ids)
          }}
        />
      )}
    </aside>
  )
}
