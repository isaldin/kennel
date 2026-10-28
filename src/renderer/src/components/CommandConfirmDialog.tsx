import { useState } from 'react'
import type { CommandRequest } from '../../../shared/audit'
import type { Server } from '../../../shared/types'
import { useT } from '../lib/prefsContext'
import { Modal } from './Modal'

interface Props {
  commands: CommandRequest[]
  /** Zero-based command round, shown as "Round N of 3". */
  round: number
  servers: Server[]
  onAnswer(approvedIds: string[]): void
}

export function CommandConfirmDialog({
  commands,
  round,
  servers,
  onAnswer
}: Props): React.JSX.Element {
  const runnable = commands.filter((c) => c.command)
  const t = useT()
  const [checked, setChecked] = useState<Set<string>>(() => new Set(runnable.map((c) => c.id)))
  const serverName = (id: number): string => servers.find((s) => s.id === id)?.name ?? `#${id}`

  const toggle = (id: string): void =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <Modal
      title={t('audit.confirm.title')}
      onClose={() => onAnswer([])}
      wide
      footer={
        <>
          <button onClick={() => onAnswer([])}>{t('audit.confirm.declineAll')}</button>
          <button
            className="primary"
            disabled={checked.size === 0}
            onClick={() => onAnswer([...checked])}
          >
            {t('audit.confirm.runSelected')}
          </button>
        </>
      }
    >
      <p className="muted small">{t('audit.confirm.intro', { round: round + 1, total: 3 })}</p>
      <ul className="command-list">
        {commands.map((c) => (
          <li key={c.id} className={c.command ? '' : 'disabled'}>
            <label>
              <input
                type="checkbox"
                disabled={!c.command}
                checked={checked.has(c.id)}
                onChange={() => toggle(c.id)}
              />
              <span className="command-server">{serverName(c.serverId)}</span>
            </label>
            <code className="mono">{c.command ?? `${c.commandId} ${JSON.stringify(c.args)}`}</code>
            {c.reason && <div className="muted small">{c.reason}</div>}
            {c.error && (
              <div className="error small">{t('audit.confirm.rejected', { error: c.error })}</div>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  )
}
