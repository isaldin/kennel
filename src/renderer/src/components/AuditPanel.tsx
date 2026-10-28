import { useEffect, useState } from 'react'
import {
  AUDIT_STOPPED,
  type AuditRun,
  type Decision,
  type DecisionKind,
  type Finding
} from '../../../shared/audit'
import type { Server } from '../../../shared/types'
import {
  DECISION_LABEL,
  SEVERITY_LABEL,
  STATUS_LABEL,
  errorText,
  groupFindings,
  isHidden
} from '../lib/audit'
import { cleanError } from '../lib/errors'
import { formatDateTime } from '../lib/format'
import { usePrefs, useT } from '../lib/prefsContext'
import { SnapshotPanel } from './SnapshotPanel'
import { ThresholdsDialog } from './ThresholdsDialog'

interface Props {
  server: Server
  /** Called after "keep" may have added a service to the registry. */
  onServicesChanged(): void
  onDiscuss(finding: Finding): void
}

const formatElapsed = (ms: number): string => {
  const sec = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

const inAWeek = (): string => new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)

const isActive = (run: AuditRun | null): boolean =>
  run !== null && !['done', 'failed'].includes(run.status)

function FindingCard({
  finding,
  decision,
  hasChat,
  onDecide,
  onDiscuss
}: {
  finding: Finding
  decision: Decision | undefined
  hasChat: boolean
  onDecide(kind: DecisionKind, until: string | null): void
  onDiscuss(): void
}): React.JSX.Element {
  const [until, setUntil] = useState(inAWeek)
  const t = useT()
  return (
    <div className={`finding ${finding.severity}`}>
      <div className="finding-head">
        <span className={`severity ${finding.severity}`}>
          {t(SEVERITY_LABEL[finding.severity])}
        </span>
        {finding.source === 'llm' && <span className="badge">Claude</span>}
        {decision && (
          <span className="badge">
            {t(DECISION_LABEL[decision.kind])}
            {decision.until ? ` ${decision.until}` : ''}
          </span>
        )}
      </div>
      <div className="finding-title">{finding.title}</div>
      {finding.explanation && <p className="finding-text">{finding.explanation}</p>}
      {finding.suggestedQuestion && <p className="finding-text">❓ {finding.suggestedQuestion}</p>}
      {finding.suggestedAction && <p className="finding-text muted">→ {finding.suggestedAction}</p>}
      <div className="finding-actions">
        <button className="primary" onClick={onDiscuss}>
          {`💬 ${hasChat ? t('audit.continueDiscussion') : t('audit.discuss')}`}
        </button>
        {(['keep', 'remove_planned', 'migrate'] as const).map((kind) => (
          <button key={kind} onClick={() => onDecide(kind, null)}>
            {t(DECISION_LABEL[kind])}
          </button>
        ))}
        <input
          type="date"
          className="date-input"
          value={until}
          onChange={(e) => setUntil(e.target.value)}
        />
        <button disabled={!until} onClick={() => onDecide('ignore_until', until)}>
          {t('audit.decision.hideUntil')}
        </button>
      </div>
    </div>
  )
}

export function AuditPanel({ server, onServicesChanged, onDiscuss }: Props): React.JSX.Element {
  const [run, setRun] = useState<AuditRun | null>(null)
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [error, setError] = useState('')
  const [showDecided, setShowDecided] = useState(false)
  const [editingThresholds, setEditingThresholds] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [chatKeys, setChatKeys] = useState<string[]>([])
  const running = isActive(run)
  const { t, lang } = usePrefs()

  useEffect(() => {
    const load = (): void => void window.api.chat.keys(server.id).then(setChatKeys)
    load()
    return window.api.chat.onUpdate((c) => {
      if (c.serverId === server.id) load()
    })
  }, [server.id])

  useEffect(() => {
    window.api.audit.latest(server.id).then(setRun)
    return window.api.audit.onUpdate((r) => {
      if (r.serverId === server.id) setRun(r)
    })
  }, [server.id])

  useEffect(() => {
    window.api.audit.decisions().then(setDecisions)
  }, [])

  // Ticks the elapsed-time counter so a long Claude call doesn't look frozen.
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])

  const start = async (): Promise<void> => {
    setError('')
    try {
      setRun(await window.api.audit.start(server.id))
    } catch (err) {
      setError(cleanError(err))
    }
  }

  const decide = async (key: string, kind: DecisionKind, until: string | null): Promise<void> => {
    const decision = await window.api.audit.decide(key, { kind, until, note: '' })
    setDecisions((list) => [...list.filter((d) => d.key !== key), decision])
    if (kind === 'keep') onServicesChanged()
  }

  const today = new Date()
  const findings = run?.findings ?? []
  const open = findings.filter((f) => !isHidden(f, decisions, today))
  const decided = findings.filter((f) => isHidden(f, decisions, today))
  const card = (f: Finding): React.JSX.Element => (
    <FindingCard
      key={f.key}
      finding={f}
      decision={decisions.find((d) => d.key === f.key)}
      hasChat={chatKeys.includes(f.key)}
      onDecide={(kind, until) => decide(f.key, kind, until)}
      onDiscuss={() => onDiscuss(f)}
    />
  )

  let statusLine = t('audit.neverChecked')
  if (run && running) {
    statusLine = `${t(STATUS_LABEL[run.status])} ${formatElapsed(now - Date.parse(run.startedAt))}`
  } else if (run) {
    const label =
      run.analyzerError === AUDIT_STOPPED ? t('audit.stoppedShort') : t(STATUS_LABEL[run.status])
    statusLine = `${label} · ${formatDateTime(run.finishedAt ?? run.startedAt, lang)}`
  }

  return (
    <>
      <section className="audit-panel">
        <div className="section-header">
          <div className="audit-title">
            <h2>{t('audit.title')}</h2>
            <span className="muted small">{statusLine}</span>
          </div>
          <div className="actions">
            {running ? (
              <button onClick={() => window.api.audit.stop(server.id)}>{t('audit.stop')}</button>
            ) : (
              <button className="primary" onClick={start}>
                {run ? t('audit.checkAgain') : t('audit.check')}
              </button>
            )}
            <button
              className="ghost"
              title={t('audit.thresholds')}
              onClick={() => setEditingThresholds(true)}
            >
              ⚙
            </button>
          </div>
        </div>

        {error && <p className="error">{error}</p>}
        {run?.serverErrors.map((e) => (
          <div key={e.serverId} className="notice error">
            {e.message}
          </div>
        ))}
        {run?.analyzerError && (
          <div className="notice">
            {run.status === 'failed'
              ? errorText(run.analyzerError, t)
              : t('audit.claudeUnavailable', { error: errorText(run.analyzerError, t) })}
          </div>
        )}

        {run &&
          (open.length === 0 ? (
            <p className="muted">{running ? t('audit.checking') : t('audit.noOpenFindings')}</p>
          ) : (
            groupFindings(open).map(([severity, list]) => (
              <div key={severity} className="finding-group">
                {list.map(card)}
              </div>
            ))
          ))}

        {run && run.items.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>{t('audit.items.object')}</th>
                <th>{t('audit.items.whatItIs')}</th>
                <th>{t('audit.items.project')}</th>
              </tr>
            </thead>
            <tbody>
              {run.items.map((item) => (
                <tr key={item.ref}>
                  <td>{item.ref}</td>
                  <td className="muted">{item.whatItIs}</td>
                  <td>
                    {item.projectGuess}
                    {item.confidence < 0.5 && <span className="badge">?</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {decided.length > 0 && (
          <div>
            <button className="ghost" onClick={() => setShowDecided((v) => !v)}>
              {showDecided ? '▾' : '▸'} {t('audit.decided', { count: decided.length })}
            </button>
            {showDecided && <div className="finding-group">{decided.map(card)}</div>}
          </div>
        )}

        {editingThresholds && <ThresholdsDialog onClose={() => setEditingThresholds(false)} />}
      </section>

      <SnapshotPanel serverId={server.id} version={run?.finishedAt ?? null} />
    </>
  )
}
