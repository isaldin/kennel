import type { MessageKey, T } from '../../../shared/i18n'
import {
  AUDIT_STOPPED,
  INTERRUPTED,
  isDecided,
  type AuditStatus,
  type Decision,
  type DecisionKind,
  type Finding,
  type Severity
} from '../../../shared/audit'

export const SEVERITY_LABEL: Record<Severity, MessageKey> = {
  critical: 'audit.severity.critical',
  warning: 'audit.severity.warning',
  info: 'audit.severity.info'
}

export const DECISION_LABEL: Record<DecisionKind, MessageKey> = {
  keep: 'audit.decision.keep',
  remove_planned: 'audit.decision.removePlanned',
  migrate: 'audit.decision.migrate',
  ignore_until: 'audit.decision.ignoreUntil'
}

export const STATUS_LABEL: Record<AuditStatus, MessageKey> = {
  collecting: 'audit.status.collecting',
  analyzing: 'audit.status.analyzing',
  awaiting_confirmation: 'audit.status.awaitingConfirmation',
  done: 'audit.status.done',
  failed: 'audit.status.failed'
}

/** An audit or chat error for display: stored sentinels are translated, other text is shown as is. */
export function errorText(error: string, t: T): string {
  if (error === AUDIT_STOPPED) return t('audit.stopped')
  if (error === INTERRUPTED) return t('audit.interrupted')
  return error
}

const SEVERITY_ORDER: Severity[] = ['critical', 'warning', 'info']

export function isHidden(finding: Finding, decisions: Decision[], now: Date): boolean {
  return isDecided(
    decisions.find((d) => d.key === finding.key),
    now
  )
}

export function groupFindings(findings: Finding[]): [Severity, Finding[]][] {
  return SEVERITY_ORDER.map((severity): [Severity, Finding[]] => [
    severity,
    findings.filter((f) => f.severity === severity)
  ]).filter(([, list]) => list.length > 0)
}
