import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { EnpassItem, EnpassStatus } from '../../../shared/types'
import { EnpassContext, useEnpass } from '../lib/enpassContext'
import { cleanError } from '../lib/errors'
import { Modal } from './Modal'

export function EnpassProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [status, setStatus] = useState<EnpassStatus>({ vaultPath: null, unlocked: false })
  const [pending, setPending] = useState<((ok: boolean) => void) | null>(null)

  const refresh = useCallback(() => window.api.enpass.status().then(setStatus), [])
  useEffect(() => {
    refresh()
  }, [refresh])

  const ensureUnlocked = useCallback(async () => {
    const current = await window.api.enpass.status()
    setStatus(current)
    if (current.unlocked) return true
    return new Promise<boolean>((resolve) => setPending(() => resolve))
  }, [])

  const lock = useCallback(async () => {
    await window.api.enpass.lock()
    await refresh()
  }, [refresh])

  const finish = (ok: boolean): void => {
    pending?.(ok)
    setPending(null)
    refresh()
  }

  return (
    <EnpassContext.Provider value={{ status, ensureUnlocked, lock }}>
      {children}
      {pending && <UnlockDialog vaultPath={status.vaultPath} onDone={finish} />}
    </EnpassContext.Provider>
  )
}

function UnlockDialog({
  vaultPath,
  onDone
}: {
  vaultPath: string | null
  onDone(ok: boolean): void
}): React.JSX.Element {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      await window.api.enpass.unlock(password)
      onDone(true)
    } catch (err) {
      setError(cleanError(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Разблокировать Enpass"
      onClose={() => onDone(false)}
      footer={
        <>
          <button onClick={() => onDone(false)}>Отмена</button>
          <button className="primary" disabled={!password || busy || !vaultPath} onClick={submit}>
            {busy ? 'Проверяю…' : 'Разблокировать'}
          </button>
        </>
      }
    >
      {vaultPath ? (
        <>
          <p className="muted">
            Хранилище открывается только на чтение. Мастер-пароль остаётся в памяти до блокировки
            или выхода.
          </p>
          <input
            type="password"
            autoFocus
            placeholder="Мастер-пароль Enpass"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && password && submit()}
          />
          {error && <p className="error">{error}</p>}
        </>
      ) : (
        <p className="error">Хранилище Enpass не найдено.</p>
      )}
    </Modal>
  )
}

export function EnpassPicker({
  onPick,
  onClose
}: {
  onPick(item: EnpassItem): void
  onClose(): void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<EnpassItem[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => {
      window.api.enpass
        .search(query)
        .then((found) => {
          setItems(found)
          setError('')
        })
        .catch((err) => setError(cleanError(err)))
    }, 150)
    return () => clearTimeout(timer)
  }, [query])

  return (
    <Modal title="Выбрать запись Enpass" onClose={onClose} wide>
      <input
        autoFocus
        placeholder="Поиск по названию, логину или URL"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {error && <p className="error">{error}</p>}
      <ul className="pick-list">
        {items.map((item) => (
          <li key={item.uuid} onClick={() => onPick(item)}>
            <div className="pick-title">{item.title}</div>
            <div className="muted small">
              {[item.username, item.url, item.category].filter(Boolean).join(' · ')}
              {!item.hasPassword && ' · без пароля'}
            </div>
          </li>
        ))}
        {items.length === 0 && !error && <li className="muted empty">Ничего не найдено</li>}
      </ul>
    </Modal>
  )
}

/** Shows a linked Enpass item with actions; `uuid` empty means "not linked". */
export function EnpassLink({
  uuid,
  onChange
}: {
  uuid: string
  onChange(uuid: string): void
}): React.JSX.Element {
  const { status, ensureUnlocked } = useEnpass()
  const [fetched, setFetched] = useState<EnpassItem | null>(null)
  const item = status.unlocked && fetched?.uuid === uuid ? fetched : null
  const [picking, setPicking] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (uuid && status.unlocked) window.api.enpass.get(uuid).then(setFetched)
  }, [uuid, status.unlocked])

  const pick = async (): Promise<void> => {
    if (await ensureUnlocked()) setPicking(true)
  }

  const copy = async (): Promise<void> => {
    if (!(await ensureUnlocked())) return
    try {
      await window.api.enpass.copyPassword(uuid)
      setMessage('Пароль скопирован, буфер очистится через 30 с')
    } catch (err) {
      setMessage(cleanError(err))
    }
    setTimeout(() => setMessage(''), 4000)
  }

  return (
    <div className="enpass-link">
      {uuid ? (
        <>
          <span className="enpass-title">
            🔑{' '}
            {item
              ? `${item.title}${item.username ? ` (${item.username})` : ''}`
              : status.unlocked
                ? 'запись не найдена'
                : 'Enpass заблокирован'}
          </span>
          <button onClick={copy}>Скопировать пароль</button>
          {item?.url && (
            <button onClick={() => window.api.openExternal(item.url)}>Открыть URL</button>
          )}
          <button onClick={pick}>Сменить</button>
          <button className="ghost" onClick={() => onChange('')}>
            Отвязать
          </button>
        </>
      ) : (
        <button onClick={pick}>Привязать запись Enpass</button>
      )}
      {message && <span className="muted small">{message}</span>}
      {picking && (
        <EnpassPicker
          onClose={() => setPicking(false)}
          onPick={(picked) => {
            setPicking(false)
            onChange(picked.uuid)
          }}
        />
      )}
    </div>
  )
}
