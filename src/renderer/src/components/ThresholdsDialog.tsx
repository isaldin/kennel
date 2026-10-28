import { useEffect, useState } from 'react'
import type { Thresholds } from '../../../shared/audit'
import { cleanError } from '../lib/errors'
import { Modal } from './Modal'

const FIELDS: [keyof Omit<Thresholds, 'publicPorts'>, string][] = [
  ['staleImageDays', 'Образ старше, дней'],
  ['noTrafficDays', 'Сайт без запросов, дней'],
  ['sslDays', 'Сертификат истекает через, дней'],
  ['diskPct', 'Диск заполнен, %'],
  ['idleRamPct', 'Простой: RAM ниже, %'],
  ['idleCpuPct', 'Простой: CPU ниже, %']
]

export function ThresholdsDialog({ onClose }: { onClose(): void }): React.JSX.Element {
  const [form, setForm] = useState<Thresholds | null>(null)
  const [ports, setPorts] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    window.api.audit.thresholds().then((t) => {
      setForm(t)
      setPorts(t.publicPorts.join(', '))
    })
  }, [])

  const save = async (): Promise<void> => {
    if (!form) return
    try {
      const publicPorts = ports
        .split(/[\s,]+/)
        .map(Number)
        .filter((p) => Number.isInteger(p) && p > 0)
      await window.api.audit.setThresholds({ ...form, publicPorts })
      onClose()
    } catch (err) {
      setError(cleanError(err))
    }
  }

  return (
    <Modal
      title="Пороги правил"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Отмена</button>
          <button className="primary" disabled={!form} onClick={save}>
            Сохранить
          </button>
        </>
      }
    >
      {form && (
        <div className="form-grid">
          {FIELDS.map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                type="number"
                min={0}
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
              />
            </label>
          ))}
          <label className="span-2">
            Порты, которые не должны быть открыты наружу
            <input value={ports} onChange={(e) => setPorts(e.target.value)} />
          </label>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </Modal>
  )
}
