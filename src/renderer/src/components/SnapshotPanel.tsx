import { useEffect, useState } from 'react'
import type { Snapshot } from '../../../shared/audit'
import { formatDateTime } from '../lib/format'
import { usePrefs } from '../lib/prefsContext'

interface Props {
  serverId: number
  /** Changes when a new audit finishes, so the panel reloads. */
  version: string | null
}

export function SnapshotPanel({ serverId, version }: Props): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<Snapshot | null | undefined>(undefined)
  const { t, lang } = usePrefs()

  useEffect(() => {
    window.api.audit.snapshot(serverId).then(setSnapshot)
  }, [serverId, version])

  if (snapshot === undefined) return <section />
  if (snapshot === null) {
    return (
      <section>
        <h2>{t('audit.snapshot.title')}</h2>
        <p className="muted">{t('audit.snapshot.none')}</p>
      </section>
    )
  }

  const customUnits = snapshot.units.filter((u) => u.custom)
  return (
    <section>
      <div className="section-header">
        <h2>{t('audit.snapshot.title')}</h2>
        <span className="muted small">
          {t('audit.snapshot.takenAt', { date: formatDateTime(snapshot.takenAt, lang) })}
        </span>
      </div>

      {snapshot.containers.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>{t('audit.snapshot.container')}</th>
              <th>{t('audit.snapshot.image')}</th>
              <th>{t('audit.snapshot.state')}</th>
              <th>{t('audit.snapshot.restarts')}</th>
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
          <span className="muted">{t('audit.snapshot.sites')} </span>
          {snapshot.vhosts.map((v) => v.domain).join(', ')}
        </p>
      )}
      {snapshot.disks.length > 0 && (
        <p>
          <span className="muted">{t('audit.snapshot.disks')} </span>
          {snapshot.disks
            .map((d) => `${d.mount} ${Math.round((d.used / d.size) * 100)}%`)
            .join(', ')}
        </p>
      )}
      {snapshot.unavailable.length > 0 && (
        <p className="muted small">
          {t('audit.snapshot.unavailable', { sections: snapshot.unavailable.join(', ') })}
        </p>
      )}
    </section>
  )
}
