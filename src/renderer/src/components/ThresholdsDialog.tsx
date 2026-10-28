import { useEffect, useState } from 'react'
import type { Thresholds } from '../../../shared/audit'
import type { MessageKey } from '../../../shared/i18n'
import { cleanError } from '../lib/errors'
import { useT } from '../lib/prefsContext'
import { Modal } from './Modal'

const FIELDS: [keyof Omit<Thresholds, 'publicPorts'>, MessageKey][] = [
  ['staleImageDays', 'audit.thresholds.staleImageDays'],
  ['noTrafficDays', 'audit.thresholds.noTrafficDays'],
  ['sslDays', 'audit.thresholds.sslDays'],
  ['diskPct', 'audit.thresholds.diskPct'],
  ['idleRamPct', 'audit.thresholds.idleRamPct'],
  ['idleCpuPct', 'audit.thresholds.idleCpuPct']
]

export function ThresholdsDialog({ onClose }: { onClose(): void }): React.JSX.Element {
  const [form, setForm] = useState<Thresholds | null>(null)
  const [ports, setPorts] = useState('')
  const [error, setError] = useState('')
  const t = useT()

  useEffect(() => {
    window.api.audit.thresholds().then((saved) => {
      setForm(saved)
      setPorts(saved.publicPorts.join(', '))
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
      title={t('audit.thresholds')}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>{t('common.cancel')}</button>
          <button className="primary" disabled={!form} onClick={save}>
            {t('common.save')}
          </button>
        </>
      }
    >
      {form && (
        <div className="form-grid">
          {FIELDS.map(([key, label]) => (
            <label key={key}>
              {t(label)}
              <input
                type="number"
                min={0}
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })}
              />
            </label>
          ))}
          <label className="span-2">
            {t('audit.thresholds.publicPorts')}
            <input value={ports} onChange={(e) => setPorts(e.target.value)} />
          </label>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </Modal>
  )
}
