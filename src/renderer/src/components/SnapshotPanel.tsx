import { useEffect, useState } from 'react'
import type { Snapshot } from '../../../shared/audit'

interface Props {
  serverId: number
  /** Changes when a new audit finishes, so the panel reloads. */
  version: string | null
}

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })

export function SnapshotPanel({ serverId, version }: Props): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<Snapshot | null | undefined>(undefined)

  useEffect(() => {
    window.api.audit.snapshot(serverId).then(setSnapshot)
  }, [serverId, version])

  if (snapshot === undefined) return <section />
  if (snapshot === null) {
    return (
      <section>
        <h2>Что крутится</h2>
        <p className="muted">Снимка ещё нет — запустите аудит.</p>
      </section>
    )
  }

  const customUnits = snapshot.units.filter((u) => u.custom)
  return (
    <section>
      <div className="section-header">
        <h2>Что крутится</h2>
        <span className="muted small">снимок {formatDate(snapshot.takenAt)}</span>
      </div>

      {snapshot.containers.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Контейнер</th>
              <th>Образ</th>
              <th>Состояние</th>
              <th>Рестарты</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.containers.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td className="muted">{c.image}</td>
                <td className={c.state === 'running' ? '' : 'error'}>{c.state}</td>
                <td>{c.restartCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {customUnits.length > 0 && (
        <p>
          <span className="muted">systemd: </span>
          {customUnits.map((u) => `${u.name} (${u.active})`).join(', ')}
        </p>
      )}
      {snapshot.vhosts.length > 0 && (
        <p>
          <span className="muted">Сайты: </span>
          {snapshot.vhosts.map((v) => v.domain).join(', ')}
        </p>
      )}
      {snapshot.disks.length > 0 && (
        <p>
          <span className="muted">Диски: </span>
          {snapshot.disks
            .map((d) => `${d.mount} ${Math.round((d.used / d.size) * 100)}%`)
            .join(', ')}
        </p>
      )}
      {snapshot.unavailable.length > 0 && (
        <p className="muted small">Не удалось собрать: {snapshot.unavailable.join(', ')}</p>
      )}
    </section>
  )
}
