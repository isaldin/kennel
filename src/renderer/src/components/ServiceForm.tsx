import { useState } from 'react'
import type { ServiceInput, ServiceKind } from '../../../shared/types'
import { cleanError } from '../lib/errors'
import { EnpassLink } from './Enpass'
import { Modal } from './Modal'

const KINDS: { value: ServiceKind; label: string }[] = [
  { value: 'docker', label: 'Docker' },
  { value: 'coolify', label: 'Coolify' },
  { value: 'systemd', label: 'systemd' },
  { value: 'other', label: 'Другое' }
]

interface Props {
  initial: ServiceInput
  title: string
  onSave(input: ServiceInput): Promise<void>
  onClose(): void
}

export function ServiceForm({ initial, title, onSave, onClose }: Props): React.JSX.Element {
  const [form, setForm] = useState<ServiceInput>(initial)
  const [error, setError] = useState('')
  const set = <K extends keyof ServiceInput>(key: K, value: ServiceInput[K]): void =>
    setForm((f) => ({ ...f, [key]: value }))

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
          <button className="primary" disabled={!form.name.trim()} onClick={save}>
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
            placeholder="n8n"
          />
        </label>
        <label>
          Где запущено
          <select value={form.kind} onChange={(e) => set('kind', e.target.value as ServiceKind)}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          URL / домен
          <input
            value={form.url}
            onChange={(e) => set('url', e.target.value)}
            placeholder="https://n8n.example.com"
          />
        </label>
        <label>
          Порт
          <input
            type="number"
            value={form.port ?? ''}
            onChange={(e) => set('port', e.target.value ? Number(e.target.value) : null)}
          />
        </label>
        <label className="span-2">
          Что это
          <input value={form.description} onChange={(e) => set('description', e.target.value)} />
        </label>
        <label className="checkbox span-2">
          <input
            type="checkbox"
            checked={form.expected}
            onChange={(e) => set('expected', e.target.checked)}
          />
          Должен работать постоянно
        </label>
        <div className="span-2">
          <div className="field-label">Доступы (Enpass)</div>
          <EnpassLink uuid={form.enpassItemUuid} onChange={(uuid) => set('enpassItemUuid', uuid)} />
        </div>
        <label className="span-2">
          Заметки
          <textarea rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
    </Modal>
  )
}
