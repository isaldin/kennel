import { useCallback, useEffect, useState } from 'react'
import type { Finding } from '../../../shared/audit'
import type { Server, Service, ServiceInput } from '../../../shared/types'
import { formatMoney, serverAddress } from '../lib/format'
import { usePrefs } from '../lib/prefsContext'
import { EnpassLink } from './Enpass'
import { emptyService, toInput } from '../lib/forms'
import { ServerForm } from './ServerForm'
import { ServiceForm } from './ServiceForm'
import { AuditPanel } from './AuditPanel'

interface Props {
  server: Server
  onConnect(server: Server): void
  /** Opens the Claude chat about an audit finding. */
  onDiscuss(finding: Finding): void
  onChanged(): void
}

const KIND_LABEL: Record<string, string> = {
  docker: 'Docker',
  coolify: 'Coolify',
  systemd: 'systemd',
  other: '—'
}

export function ServerDetail({
  server,
  onConnect,
  onDiscuss,
  onChanged
}: Props): React.JSX.Element {
  const { t, lang } = usePrefs()
  const [services, setServices] = useState<Service[]>([])
  const [editing, setEditing] = useState(false)
  const [serviceForm, setServiceForm] = useState<{ id: number | null; input: ServiceInput } | null>(
    null
  )

  const loadServices = useCallback(
    () => window.api.services.list(server.id).then(setServices),
    [server.id]
  )
  useEffect(() => {
    loadServices()
  }, [loadServices])

  const linkEnpass = async (uuid: string): Promise<void> => {
    await window.api.servers.update(server.id, { ...toInput(server), enpassItemUuid: uuid })
    onChanged()
  }

  const remove = async (): Promise<void> => {
    if (!confirm(t('server.confirmDelete', { name: server.name }))) return
    await window.api.servers.remove(server.id)
    onChanged()
  }

  const saveService = async (input: ServiceInput): Promise<void> => {
    if (serviceForm?.id) await window.api.services.update(serviceForm.id, input)
    else await window.api.services.create(input)
    setServiceForm(null)
    loadServices()
  }

  const removeService = async (service: Service): Promise<void> => {
    if (!confirm(t('server.confirmDeleteService', { name: service.name }))) return
    await window.api.services.remove(service.id)
    loadServices()
  }

  return (
    <div className="detail">
      <header className="detail-header">
        <div>
          <h1>{server.name}</h1>
          <div className="muted">
            {[server.project, server.provider, serverAddress(server)].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div className="actions">
          <button className="primary" onClick={() => onConnect(server)}>
            {t('server.connect')}
          </button>
          <button onClick={() => setEditing(true)}>{t('common.edit')}</button>
          <button className="ghost danger" onClick={remove}>
            {t('common.delete')}
          </button>
        </div>
      </header>

      <section className="cards">
        <div className="card">
          <div className="card-label">{t('server.perMonth')}</div>
          <div className="card-value">
            {server.monthlyCost > 0 ? formatMoney(server.monthlyCost, server.currency, lang) : '—'}
          </div>
          {server.billingDay && (
            <div className="muted small">{t('server.billingDay', { day: server.billingDay })}</div>
          )}
        </div>
        <div className="card">
          <div className="card-label">{t('server.login')}</div>
          <div className="card-value small">
            {server.identityFile
              ? server.identityFile.replace(/^.*\//, '')
              : server.sshAlias
                ? t('server.loginSshConfig')
                : 'ssh-agent'}
            {server.enpassItemUuid ? t('server.loginEnpass') : ''}
          </div>
        </div>
        <div className="card">
          <div className="card-label">{t('server.servicesCount')}</div>
          <div className="card-value">{services.length}</div>
        </div>
      </section>

      <section>
        <h2>{t('server.access')}</h2>
        <EnpassLink uuid={server.enpassItemUuid} onChange={linkEnpass} />
        {server.panelUrl && (
          <p>
            <a
              href="#"
              onClick={(e) => (e.preventDefault(), window.api.openExternal(server.panelUrl))}
            >
              {t('server.providerPanel')}
            </a>
          </p>
        )}
      </section>

      <section>
        <div className="section-header">
          <h2>{t('server.services')}</h2>
          <button onClick={() => setServiceForm({ id: null, input: emptyService(server.id) })}>
            {t('server.addService')}
          </button>
        </div>
        {services.length === 0 ? (
          <p className="muted">{t('server.noServices')}</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t('server.colName')}</th>
                <th>{t('server.colWhere')}</th>
                <th>{t('server.colUrl')}</th>
                <th>{t('server.colWhat')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.name}
                    {!s.expected && <span className="badge">{t('server.notRequired')}</span>}
                    {s.enpassItemUuid && <span title={t('server.hasEnpass')}> 🔑</span>}
                  </td>
                  <td>{KIND_LABEL[s.kind]}</td>
                  <td>
                    {s.url ? (
                      <a
                        href="#"
                        onClick={(e) => (e.preventDefault(), window.api.openExternal(s.url))}
                      >
                        {s.url.replace(/^https?:\/\//, '')}
                      </a>
                    ) : s.port ? (
                      `:${s.port}`
                    ) : (
                      ''
                    )}
                  </td>
                  <td className="muted">{s.description}</td>
                  <td className="row-actions">
                    <button
                      className="ghost"
                      onClick={() => {
                        // eslint-disable-next-line @typescript-eslint/no-unused-vars
                        const { id, createdAt, updatedAt, ...input } = s
                        setServiceForm({ id, input })
                      }}
                    >
                      {t('common.edit')}
                    </button>
                    <button className="ghost danger" onClick={() => removeService(s)}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <AuditPanel server={server} onServicesChanged={loadServices} onDiscuss={onDiscuss} />

      {server.notes && (
        <section>
          <h2>{t('server.notes')}</h2>
          <p className="notes">{server.notes}</p>
        </section>
      )}

      {editing && (
        <ServerForm
          title={t('server.editServer')}
          initial={toInput(server)}
          onClose={() => setEditing(false)}
          onSave={async (input) => {
            await window.api.servers.update(server.id, input)
            setEditing(false)
            onChanged()
          }}
        />
      )}
      {serviceForm && (
        <ServiceForm
          title={serviceForm.id ? t('server.editService') : t('server.newService')}
          initial={serviceForm.input}
          onClose={() => setServiceForm(null)}
          onSave={saveService}
        />
      )}
    </div>
  )
}
