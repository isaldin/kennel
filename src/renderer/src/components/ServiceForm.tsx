import { useState } from 'react'
import type { ServiceInput, ServiceKind } from '../../../shared/types'
import type { T } from '../../../shared/i18n'
import { cleanError } from '../lib/errors'
import { useT } from '../lib/prefsContext'
import { EnpassLink } from './Enpass'
import { Modal } from './Modal'

/** Product names stay as is; only "other" is translated. */
const KINDS: { value: ServiceKind; label: (t: T) => string }[] = [
  { value: 'docker', label: () => 'Docker' },
  { value: 'coolify', label: () => 'Coolify' },
  { value: 'systemd', label: () => 'systemd' },
  { value: 'other', label: (t) => t('server.kindOther') }
]

interface Props {
  initial: ServiceInput
  title: string
  onSave(input: ServiceInput): Promise<void>
  onClose(): void
}

export function ServiceForm({ initial, title, onSave, onClose }: Props): React.JSX.Element {
  const t = useT()
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
          <button onClick={onClose}>{t('common.cancel')}</button>
          <button className="primary" disabled={!form.name.trim()} onClick={save}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>
          {t('server.form.name')}
          <input
            autoFocus
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="n8n"
          />
        </label>
        <label>
          {t('server.service.where')}
          <select value={form.kind} onChange={(e) => set('kind', e.target.value as ServiceKind)}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label(t)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('server.service.url')}
          <input
            value={form.url}
            onChange={(e) => set('url', e.target.value)}
            placeholder="https://n8n.example.com"
          />
        </label>
        <label>
          {t('server.form.port')}
          <input
            type="number"
            value={form.port ?? ''}
            onChange={(e) => set('port', e.target.value ? Number(e.target.value) : null)}
          />
        </label>
        <label className="span-2">
          {t('server.service.what')}
          <input value={form.description} onChange={(e) => set('description', e.target.value)} />
        </label>
        <label className="checkbox span-2">
          <input
            type="checkbox"
            checked={form.expected}
            onChange={(e) => set('expected', e.target.checked)}
          />
          {t('server.service.expected')}
        </label>
        <div className="span-2">
          <div className="field-label">{t('server.service.access')}</div>
          <EnpassLink uuid={form.enpassItemUuid} onChange={(uuid) => set('enpassItemUuid', uuid)} />
        </div>
        <label className="span-2">
          {t('server.notes')}
          <textarea rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
    </Modal>
  )
}
