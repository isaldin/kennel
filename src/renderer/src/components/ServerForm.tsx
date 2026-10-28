import { useState } from 'react'
import type { ServerInput } from '../../../shared/types'
import { cleanError } from '../lib/errors'
import { Modal } from './Modal'

const PROVIDERS = ['DigitalOcean', 'Contabo', 'hoster.kz', 'Hetzner', 'Vultr', 'Timeweb']
const CURRENCIES = ['USD', 'EUR', 'KZT', 'RUB']

interface Props {
  initial: ServerInput
  title: string
  onSave(input: ServerInput): Promise<void>
  onClose(): void
}

export function ServerForm({ initial, title, onSave, onClose }: Props): React.JSX.Element {
  const [form, setForm] = useState<ServerInput>(initial)
  const [error, setError] = useState('')
  const set = <K extends keyof ServerInput>(key: K, value: ServerInput[K]): void =>
    setForm((f) => ({ ...f, [key]: value }))

  const valid = form.name.trim() && (form.host.trim() || form.sshAlias.trim())

  const save = async (): Promise<void> => {
    try {
      await onSave(form)
    } catch (err) {
      setError(cleanError(err))
    }
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          <button onClick={onClose}>Отмена</button>
          <button className="primary" disabled={!valid} onClick={save}>
            Сохранить
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          Название
          <input
            autoFocus
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="dimetra-prod"
          />
        </label>
        <label>
          Проект
          <input
            value={form.project}
            onChange={(e) => set('project', e.target.value)}
            placeholder="Dimetra"
          />
        </label>
        <label>
          Провайдер
          <input
            list="providers"
            value={form.provider}
            onChange={(e) => set('provider', e.target.value)}
          />
          <datalist id="providers">
            {PROVIDERS.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>
        <label>
          Панель провайдера (URL)
          <input
            value={form.panelUrl}
            onChange={(e) => set('panelUrl', e.target.value)}
            placeholder="https://"
          />
        </label>

        <h3 className="span-2">Подключение</h3>
        <label>
          Хост / IP
          <input
            value={form.host}
            onChange={(e) => set('host', e.target.value)}
            placeholder="Пусто — взять из ssh config"
          />
        </label>
        <label>
          Алиас в ~/.ssh/config
          <input value={form.sshAlias} onChange={(e) => set('sshAlias', e.target.value)} />
        </label>
        <label>
          Пользователь
          <input value={form.username} onChange={(e) => set('username', e.target.value)} />
        </label>
        <label>
          Порт
          <input
            type="number"
            value={form.port}
            onChange={(e) => set('port', Number(e.target.value) || 22)}
          />
        </label>
        <label className="span-2">
          Ключ (путь к файлу)
          <input
            value={form.identityFile}
            onChange={(e) => set('identityFile', e.target.value)}
            placeholder="Пусто — ssh-agent и ключи из ssh config / ~/.ssh/id_*"
          />
        </label>

        <h3 className="span-2">Оплата</h3>
        <label>
          Стоимость в месяц
          <input
            type="number"
            step="0.01"
            value={form.monthlyCost}
            onChange={(e) => set('monthlyCost', Number(e.target.value))}
          />
        </label>
        <label>
          Валюта
          <select value={form.currency} onChange={(e) => set('currency', e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          День оплаты
          <input
            type="number"
            min={1}
            max={31}
            value={form.billingDay ?? ''}
            onChange={(e) => set('billingDay', e.target.value ? Number(e.target.value) : null)}
          />
        </label>
        <div />
        <label className="span-2">
          Заметки
          <textarea rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
    </Modal>
  )
}
