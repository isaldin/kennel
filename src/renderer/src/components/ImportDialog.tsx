import { useEffect, useState } from 'react'
import type { SshConfigHost } from '../../../shared/types'
import { cleanError } from '../lib/errors'
import { useT } from '../lib/prefsContext'
import { Modal } from './Modal'

/** Git hosting entries in ssh config are not servers the user pays for. */
const GIT_HOSTS = /(^|\.)(github\.com|gitlab\.com|bitbucket\.org)$/i

export function ImportDialog({
  onDone,
  onClose
}: {
  onDone(): void
  onClose(): void
}): React.JSX.Element {
  const t = useT()
  const [hosts, setHosts] = useState<SshConfigHost[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')

  useEffect(() => {
    window.api.sshConfig
      .hosts()
      .then((found) => {
        setHosts(found)
        setSelected(
          new Set(
            found
              .filter((h) => !h.alreadyImported && !GIT_HOSTS.test(h.hostName))
              .map((h) => h.alias)
          )
        )
      })
      .catch((err) => setError(cleanError(err)))
  }, [])

  const toggle = (alias: string): void =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(alias)) next.delete(alias)
      else next.add(alias)
      return next
    })

  const submit = async (): Promise<void> => {
    await window.api.sshConfig.importHosts([...selected])
    onDone()
  }

  return (
    <Modal
      title={t('server.import.title')}
      onClose={onClose}
      wide
      footer={
        <>
          <button onClick={onClose}>{t('common.cancel')}</button>
          <button className="primary" disabled={selected.size === 0} onClick={submit}>
            {t('server.import.submit', { count: selected.size })}
          </button>
        </>
      }
    >
      {error && <p className="error">{error}</p>}
      <table className="table">
        <thead>
          <tr>
            <th />
            <th>{t('server.import.alias')}</th>
            <th>{t('server.import.address')}</th>
            <th>{t('server.import.key')}</th>
          </tr>
        </thead>
        <tbody>
          {hosts.map((h) => (
            <tr key={h.alias} className={h.alreadyImported ? 'muted' : ''}>
              <td>
                <input
                  type="checkbox"
                  disabled={h.alreadyImported}
                  checked={selected.has(h.alias)}
                  onChange={() => toggle(h.alias)}
                />
              </td>
              <td>{h.alias}</td>
              <td>
                {h.user ? `${h.user}@` : ''}
                {h.hostName}
                {h.port !== 22 ? `:${h.port}` : ''}
              </td>
              <td className="small">
                {h.alreadyImported
                  ? t('server.import.already')
                  : h.identityFile.replace(/^.*\//, '')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  )
}
