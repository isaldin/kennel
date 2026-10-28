import { useEffect, useState } from 'react'
import { AUTO_AUDIT_HOURS } from '../../../shared/audit'
import { cleanError } from '../lib/errors'
import { TERM_FONTS, TERM_FONT_SIZES, ZOOMS } from '../lib/prefs'
import { usePrefs } from '../lib/prefsContext'
import { THEMES, type Theme, type ThemeChoice } from '../lib/themes'
import { Modal } from './Modal'
import { ThresholdsDialog } from './ThresholdsDialog'

const AUTO_AUDIT_LABEL: Record<number, string> = {
  0: 'Выключена',
  6: 'Каждые 6 часов',
  12: 'Каждые 12 часов',
  24: 'Раз в день',
  168: 'Раз в неделю'
}

/** A miniature of the app window in the theme's colors. */
function ThemePreview({ theme }: { theme: Theme }): React.JSX.Element {
  const c = theme.ui
  return (
    <div className="theme-preview" style={{ background: c.bg, borderColor: c.border }}>
      <div className="theme-preview-bar" style={{ background: c['bg-sunken'] }} />
      <div className="theme-preview-side" style={{ background: c['bg-elevated'] }}>
        <i style={{ background: c['bg-selected'] }} />
        <i style={{ background: c.muted }} />
      </div>
      <div className="theme-preview-main">
        <i style={{ background: c.text }} />
        <i style={{ background: c.muted }} />
        <i className="theme-preview-accent" style={{ background: c.accent }} />
      </div>
    </div>
  )
}

function ThemeCard({
  choice,
  label,
  selected,
  preview,
  onSelect
}: {
  choice: ThemeChoice
  label: string
  selected: boolean
  preview: React.JSX.Element
  onSelect(choice: ThemeChoice): void
}): React.JSX.Element {
  return (
    <button
      className={`theme-card${selected ? ' selected' : ''}`}
      aria-pressed={selected}
      onClick={() => onSelect(choice)}
    >
      {preview}
      <span>{label}</span>
    </button>
  )
}

export function SettingsDialog({ onClose }: { onClose(): void }): React.JSX.Element {
  const { prefs, update } = usePrefs()
  const [autoHours, setAutoHours] = useState<number | null>(null)
  const [editingThresholds, setEditingThresholds] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    window.api.audit.autoAuditHours().then(setAutoHours)
  }, [])

  const changeAutoHours = async (hours: number): Promise<void> => {
    setError('')
    try {
      await window.api.audit.setAutoAuditHours(hours)
      setAutoHours(hours)
    } catch (err) {
      setError(cleanError(err))
    }
  }

  if (editingThresholds) return <ThresholdsDialog onClose={() => setEditingThresholds(false)} />

  return (
    <Modal
      title="Настройки"
      wide
      onClose={onClose}
      footer={
        <button className="primary" onClick={onClose}>
          Готово
        </button>
      }
    >
      <div className="settings">
        <section>
          <h3>Тема</h3>
          <div className="theme-grid">
            <ThemeCard
              choice="system"
              label="Как в системе"
              selected={prefs.theme === 'system'}
              onSelect={(theme) => update({ theme })}
              preview={
                <div className="theme-preview-split">
                  <ThemePreview theme={THEMES.light} />
                  <ThemePreview theme={THEMES.dark} />
                </div>
              }
            />
            {Object.entries(THEMES).map(([id, theme]) => (
              <ThemeCard
                key={id}
                choice={id as ThemeChoice}
                label={theme.label}
                selected={prefs.theme === id}
                onSelect={(choice) => update({ theme: choice })}
                preview={<ThemePreview theme={theme} />}
              />
            ))}
          </div>
        </section>

        <section>
          <h3>Масштаб интерфейса</h3>
          <div className="segmented">
            {ZOOMS.map((zoom) => (
              <button
                key={zoom}
                className={prefs.zoom === zoom ? 'selected' : ''}
                aria-pressed={prefs.zoom === zoom}
                onClick={() => update({ zoom })}
              >
                {Math.round(zoom * 100)}%
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3>Терминал</h3>
          <div className="form-grid">
            <label>
              Шрифт
              <select
                value={prefs.termFontFamily}
                onChange={(e) => update({ termFontFamily: e.target.value })}
              >
                {TERM_FONTS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Размер шрифта
              <select
                value={prefs.termFontSize}
                onChange={(e) => update({ termFontSize: Number(e.target.value) })}
              >
                {TERM_FONT_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size} px
                  </option>
                ))}
              </select>
            </label>
            <label className="checkbox span-2">
              <input
                type="checkbox"
                checked={prefs.cursorBlink}
                onChange={(e) => update({ cursorBlink: e.target.checked })}
              />
              Мигающий курсор
            </label>
          </div>
        </section>

        <section>
          <h3>Аудит</h3>
          <div className="form-grid">
            <label>
              Автоматическая перепроверка
              <select
                value={autoHours ?? ''}
                disabled={autoHours === null}
                onChange={(e) => changeAutoHours(Number(e.target.value))}
              >
                {AUTO_AUDIT_HOURS.map((hours) => (
                  <option key={hours} value={hours}>
                    {AUTO_AUDIT_LABEL[hours]}
                  </option>
                ))}
              </select>
            </label>
            <div className="settings-inline">
              <button onClick={() => setEditingThresholds(true)}>Пороги правил…</button>
            </div>
            <p className="muted small span-2">
              Автопроверка идёт, пока приложение открыто, и только для серверов, которые ты уже хотя
              бы раз проверил вручную.
            </p>
          </div>
          {error && <p className="error">{error}</p>}
        </section>
      </div>
    </Modal>
  )
}
