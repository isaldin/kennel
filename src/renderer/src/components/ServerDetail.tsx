import { useCallback, useEffect, useState } from 'react'
import type { Finding } from '../../../shared/audit'
import type { Server, Service, ServiceInput } from '../../../shared/types'
import { formatMoney, serverAddress } from '../lib/format'
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
    if (
      !confirm(
        `Удалить сервер «${server.name}» и все его сервисы из списка? На самом сервере ничего не изменится.`
      )
    )
      return
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
    if (!confirm(`Удалить сервис «${service.name}» из списка?`)) return
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
            Подключиться
          </button>
          <button onClick={() => setEditing(true)}>Изменить</button>
          <button className="ghost danger" onClick={remove}>
            Удалить
          </button>
        </div>
      </header>

      <section className="cards">
        <div className="card">
          <div className="card-label">В месяц</div>
          <div className="card-value">
            {server.monthlyCost > 0 ? formatMoney(server.monthlyCost, server.currency) : '—'}
          </div>
          {server.billingDay && (
            <div className="muted small">оплата {server.billingDay}-го числа</div>
          )}
        </div>
        <div className="card">
          <div className="card-label">Вход</div>
          <div className="card-value small">
            {server.identityFile
              ? server.identityFile.replace(/^.*\//, '')
              : server.sshAlias
                ? 'из ssh config'
                : 'ssh-agent'}
            {server.enpassItemUuid ? ' + пароль Enpass' : ''}
          </div>
        </div>
        <div className="card">
          <div className="card-label">Сервисов</div>
          <div className="card-value">{services.length}</div>
        </div>
      </section>

      <section>
        <h2>Доступы</h2>
        <EnpassLink uuid={server.enpassItemUuid} onChange={linkEnpass} />
        {server.panelUrl && (
          <p>
            <a
              href="#"
              onClick={(e) => (e.preventDefault(), window.api.openExternal(server.panelUrl))}
            >
              Панель провайдера ↗
            </a>
          </p>
        )}
      </section>

      <section>
        <div className="section-header">
          <h2>Сервисы</h2>
          <button onClick={() => setServiceForm({ id: null, input: emptyService(server.id) })}>
            + Сервис
          </button>
        </div>
        {services.length === 0 ? (
          <p className="muted">
            Пока пусто. Добавь сайты, ботов и базы, которые здесь крутятся, или запусти аудит: он
            найдёт их сам.
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Название</th>
                <th>Где</th>
                <th>URL</th>
                <th>Что это</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.name}
                    {!s.expected && <span className="badge">не обязателен</span>}
                    {s.enpassItemUuid && <span title="Есть доступы в Enpass"> 🔑</span>}
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
                      Изменить
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
          <h2>Заметки</h2>
          <p className="notes">{server.notes}</p>
        </section>
      )}

      {editing && (
        <ServerForm
          title="Изменить сервер"
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
          title={serviceForm.id ? 'Изменить сервис' : 'Новый сервис'}
          initial={serviceForm.input}
          onClose={() => setServiceForm(null)}
          onSave={saveService}
        />
      )}
    </div>
  )
}
