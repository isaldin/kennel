import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AuditRun, ChatStatus } from '../../shared/audit'
import type { HostKeyPrompt, Server } from '../../shared/types'
import { ChatDrawer } from './components/ChatDrawer'
import { CommandConfirmDialog } from './components/CommandConfirmDialog'
import { EnpassProvider } from './components/Enpass'
import { HostKeyDialog } from './components/HostKeyDialog'
import { ImportDialog } from './components/ImportDialog'
import { ServerDetail } from './components/ServerDetail'
import { PrefsProvider } from './components/PrefsProvider'
import { ServerForm } from './components/ServerForm'
import { SettingsDialog } from './components/SettingsDialog'
import { TerminalView } from './components/TerminalView'
import {
  bindTerminal,
  chatId,
  clampWidth,
  openChat,
  unbindTerminal,
  visibleChat,
  type OpenChat
} from './lib/chatDock'
import { useEnpass } from './lib/enpassContext'
import { formatMoney, serverAddress, totalsByCurrency } from './lib/format'
import { EMPTY_SERVER } from './lib/forms'

interface TerminalTab {
  key: string
  serverId: number
  title: string
  status: 'connecting' | 'connected' | 'closed'
}

const HOME = 'home'
const CHAT_WIDTH_KEY = 'chatWidth'

function Shell(): React.JSX.Element {
  const [servers, setServers] = useState<Server[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [filter, setFilter] = useState('')
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [activeTab, setActiveTab] = useState(HOME)
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [hostKeyPrompts, setHostKeyPrompts] = useState<HostKeyPrompt[]>([])
  /** Runs waiting for command confirmation, oldest first; the dialog shows one at a time. */
  const [confirming, setConfirming] = useState<AuditRun[]>([])
  /** `${runId}:${round}` of command batches already answered, so the dialog closes at once. */
  const [answered, setAnswered] = useState<string[]>([])
  /** Finding chats docked on the right; one shows at a time, picked from the chat tabs. */
  const [openChats, setOpenChats] = useState<OpenChat[]>([])
  /** The chat shown on the Серверы tab; a terminal tab shows the chat that opened it. */
  const [homeChatId, setHomeChatId] = useState<string | null>(null)
  const [chatStatus, setChatStatus] = useState<Record<string, ChatStatus>>({})
  const [chatWidth, setChatWidth] = useState(() => {
    try {
      return Number(localStorage.getItem(CHAT_WIDTH_KEY)) || 440
    } catch {
      return 440
    }
  })
  const enpass = useEnpass()

  const applyServers = useCallback((list: Server[]) => {
    setServers(list)
    setSelectedId((id) =>
      id !== null && list.some((s) => s.id === id) ? id : (list[0]?.id ?? null)
    )
  }, [])

  const reload = useCallback(() => window.api.servers.list().then(applyServers), [applyServers])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey && e.key === ',') {
        e.preventDefault()
        setShowSettings(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    window.api.servers.list().then(applyServers)
  }, [applyServers])

  useEffect(() => {
    const offUpdate = window.api.audit.onUpdate((run) =>
      setConfirming((list) => [
        ...list.filter((r) => r.id !== run.id),
        ...(run.status === 'awaiting_confirmation' ? [run] : [])
      ])
    )
    const offFocus = window.api.audit.onFocus((serverId) => {
      setActiveTab(HOME)
      setSelectedId(serverId)
    })
    return () => {
      offUpdate()
      offFocus()
    }
  }, [])

  useEffect(
    () =>
      window.api.chat.onUpdate((c) =>
        setChatStatus((map) => ({ ...map, [chatId(c.serverId, c.findingKey)]: c.status }))
      ),
    []
  )

  useEffect(
    () =>
      window.api.ssh.onHostKeyPrompt((prompt) => setHostKeyPrompts((queue) => [...queue, prompt])),
    []
  )

  const connect = (server: Server): string => {
    const key = crypto.randomUUID()
    setTabs((t) => [...t, { key, serverId: server.id, title: server.name, status: 'connecting' }])
    setActiveTab(key)
    return key
  }

  const discuss = (serverId: number, key: string, title: string): void => {
    setOpenChats((list) => openChat(list, { serverId, key, title }))
    setHomeChatId(chatId(serverId, key))
  }

  const terminalOpen = (c: OpenChat): boolean =>
    c.terminalKey !== null && tabs.some((t) => t.key === c.terminalKey)

  const selectChat = (c: OpenChat): void => {
    if (terminalOpen(c)) {
      setActiveTab(c.terminalKey!)
    } else {
      setActiveTab(HOME)
      setHomeChatId(c.id)
    }
  }

  /** Goes to the chat's own terminal, opening it on first use. */
  const openChatTerminal = (c: OpenChat, server: Server): void => {
    if (terminalOpen(c)) {
      setActiveTab(c.terminalKey!)
      return
    }
    const key = connect(server)
    const topic = c.title.length > 24 ? `${c.title.slice(0, 23)}…` : c.title
    setTabs((t) => t.map((x) => (x.key === key ? { ...x, title: `${server.name} · ${topic}` } : x)))
    setOpenChats((list) => bindTerminal(list, c.id, key))
  }

  const closeChat = (id: string): void => {
    setOpenChats((list) => {
      const next = list.filter((c) => c.id !== id)
      setHomeChatId((current) => (current === id ? (next.at(-1)?.id ?? null) : current))
      return next
    })
  }

  const startResize = (e: React.MouseEvent): void => {
    e.preventDefault()
    let width = chatWidth
    const onMove = (ev: MouseEvent): void => {
      width = clampWidth(window.innerWidth - ev.clientX, window.innerWidth)
      setChatWidth(width)
    }
    const onUp = (): void => {
      document.body.classList.remove('resizing')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      try {
        localStorage.setItem(CHAT_WIDTH_KEY, String(width))
      } catch {
        // Width just won't be remembered.
      }
    }
    document.body.classList.add('resizing')
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const closeTab = useCallback((key: string) => {
    setOpenChats((list) => unbindTerminal(list, key))
    setTabs((t) => {
      const index = t.findIndex((tab) => tab.key === key)
      const next = t.filter((tab) => tab.key !== key)
      setActiveTab((active) =>
        active === key ? (next[index - 1]?.key ?? next[index]?.key ?? HOME) : active
      )
      return next
    })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.metaKey) return
      if (e.key === 'w' && activeTab !== HOME) {
        e.preventDefault()
        closeTab(activeTab)
      } else if (/^[1-9]$/.test(e.key)) {
        e.preventDefault()
        const order = [HOME, ...tabs.map((t) => t.key)]
        const target = order[Number(e.key) - 1]
        if (target) setActiveTab(target)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeTab, tabs, closeTab])

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const list = q
      ? servers.filter((s) =>
          [s.name, s.project, s.provider, s.host, s.sshAlias].some((v) =>
            v.toLowerCase().includes(q)
          )
        )
      : servers
    const groups = new Map<string, Server[]>()
    for (const s of list) {
      const group = s.project || 'Без проекта'
      groups.set(group, [...(groups.get(group) ?? []), s])
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [servers, filter])

  const pendingRun = confirming.find((r) => !answered.includes(`${r.id}:${r.round}`))
  const shownChat = visibleChat(openChats, activeTab, HOME, homeChatId)
  const serverOf = (id: number): Server | undefined => servers.find((s) => s.id === id)
  const totals = totalsByCurrency(servers)
  const selected = servers.find((s) => s.id === selectedId) ?? null

  return (
    <div className="app">
      <div className="tabbar">
        <div
          className={`tab${activeTab === HOME ? ' active' : ''}`}
          onClick={() => setActiveTab(HOME)}
        >
          Серверы
        </div>
        {tabs.map((tab) => (
          <div
            key={tab.key}
            className={`tab${activeTab === tab.key ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            <span className={`dot ${tab.status}`} />
            {openChats.some((c) => c.terminalKey === tab.key) && '💬 '}
            {tab.title}
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation()
                closeTab(tab.key)
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="body">
        {activeTab === HOME && (
          <>
            <aside className="sidebar">
              <input
                className="search"
                placeholder="Поиск"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <div className="server-list">
                {visible.map(([group, list]) => (
                  <div key={group}>
                    <div className="group-title">{group}</div>
                    {list.map((s) => (
                      <div
                        key={s.id}
                        className={`server-item${s.id === selectedId ? ' selected' : ''}`}
                        onClick={() => setSelectedId(s.id)}
                        onDoubleClick={() => connect(s)}
                      >
                        <div className="server-name">{s.name}</div>
                        <div className="muted small">
                          {s.provider || serverAddress(s)}
                          {s.monthlyCost > 0 && ` · ${formatMoney(s.monthlyCost, s.currency)}`}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
                {servers.length === 0 && (
                  <p className="muted small empty">
                    Серверов пока нет. Добавь вручную или импортируй из ~/.ssh/config.
                  </p>
                )}
              </div>
              <div className="sidebar-footer">
                <div className="totals">
                  {totals.length ? (
                    totals.map(([currency, sum]) => (
                      <div key={currency}>{formatMoney(sum, currency)} / мес</div>
                    ))
                  ) : (
                    <span className="muted small">Стоимость не указана</span>
                  )}
                </div>
                <div className="sidebar-actions">
                  <button onClick={() => setCreating(true)}>+ Сервер</button>
                  <button onClick={() => setImporting(true)}>Импорт</button>
                  <button
                    className="icon-only"
                    title="Настройки (⌘,)"
                    onClick={() => setShowSettings(true)}
                  >
                    ⚙
                  </button>
                </div>
                <div className="enpass-status small">
                  {enpass.status.vaultPath ? (
                    enpass.status.unlocked ? (
                      <>
                        🔓 Enpass открыт{' '}
                        <a href="#" onClick={(e) => (e.preventDefault(), enpass.lock())}>
                          заблокировать
                        </a>
                      </>
                    ) : (
                      <>
                        🔒 Enpass{' '}
                        <a href="#" onClick={(e) => (e.preventDefault(), enpass.ensureUnlocked())}>
                          разблокировать
                        </a>
                      </>
                    )
                  ) : (
                    <span className="muted">Enpass не найден</span>
                  )}
                </div>
              </div>
            </aside>
            <main className="main">
              {selected ? (
                <ServerDetail
                  key={selected.id}
                  server={selected}
                  onConnect={connect}
                  onDiscuss={(f) => discuss(selected.id, f.key, f.title)}
                  onChanged={reload}
                />
              ) : (
                <div className="placeholder muted">Выбери сервер слева</div>
              )}
            </main>
          </>
        )}
        <div className="terminals" style={{ display: activeTab === HOME ? 'none' : 'block' }}>
          {tabs.map((tab) => (
            <TerminalView
              key={tab.key}
              serverId={tab.serverId}
              active={activeTab === tab.key}
              onStatus={(status) =>
                setTabs((t) => t.map((x) => (x.key === tab.key ? { ...x, status } : x)))
              }
            />
          ))}
        </div>
        {shownChat && (
          <div className="chat-column" style={{ width: chatWidth }}>
            <div
              className="chat-resizer"
              title="Потяни, чтобы изменить ширину"
              onMouseDown={startResize}
            />
            {openChats.length > 1 && (
              <div className="chat-tabs">
                {openChats.map((c) => (
                  <div
                    key={c.id}
                    className={`chat-tab${c.id === shownChat.id ? ' active' : ''}`}
                    title={`${serverOf(c.serverId)?.name ?? ''}: ${c.title}`}
                    onClick={() => selectChat(c)}
                  >
                    {chatStatus[c.id] === 'awaiting_confirmation' ? (
                      <span className="dot connecting" title="Ждёт подтверждения команд" />
                    ) : chatStatus[c.id] === 'thinking' ? (
                      <span className="dot connecting" title="Claude отвечает" />
                    ) : null}
                    <span className="chat-tab-title">{c.title}</span>
                    {terminalOpen(c) && <span title="Есть свой терминал">⌨</span>}
                    <button
                      className="tab-close"
                      title="Закрыть чат"
                      onClick={(e) => {
                        e.stopPropagation()
                        closeChat(c.id)
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            {openChats.map((c) => {
              const server = serverOf(c.serverId)
              return (
                server && (
                  <ChatDrawer
                    key={c.id}
                    hidden={c.id !== shownChat.id}
                    server={server}
                    findingKey={c.key}
                    findingTitle={c.title}
                    terminalOpen={terminalOpen(c)}
                    onOpenTerminal={() => openChatTerminal(c, server)}
                    onClose={() => closeChat(c.id)}
                  />
                )
              )
            })}
          </div>
        )}
      </div>

      {creating && (
        <ServerForm
          title="Новый сервер"
          initial={EMPTY_SERVER}
          onClose={() => setCreating(false)}
          onSave={async (input) => {
            const created = await window.api.servers.create(input)
            setCreating(false)
            await reload()
            setSelectedId(created.id)
          }}
        />
      )}
      {importing && (
        <ImportDialog
          onClose={() => setImporting(false)}
          onDone={() => {
            setImporting(false)
            reload()
          }}
        />
      )}
      {pendingRun && (
        <CommandConfirmDialog
          key={`${pendingRun.id}:${pendingRun.round}`}
          commands={pendingRun.pendingCommands}
          round={pendingRun.round}
          servers={servers}
          onAnswer={(ids) => {
            setAnswered((list) => [...list, `${pendingRun.id}:${pendingRun.round}`])
            window.api.audit.answerCommands(pendingRun.id, ids)
          }}
        />
      )}
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      {hostKeyPrompts[0] && (
        <HostKeyDialog
          prompt={hostKeyPrompts[0]}
          onAnswer={(accept) => {
            window.api.ssh.answerHostKey(hostKeyPrompts[0].promptId, accept)
            setHostKeyPrompts((queue) => queue.slice(1))
          }}
        />
      )}
    </div>
  )
}

export default function App(): React.JSX.Element {
  return (
    <PrefsProvider>
      <EnpassProvider>
        <Shell />
      </EnpassProvider>
    </PrefsProvider>
  )
}
