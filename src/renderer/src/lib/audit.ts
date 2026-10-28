import {
  isDecided,
  type AuditStatus,
  type Decision,
  type DecisionKind,
  type Finding,
  type Severity
} from '../../../shared/audit'

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Критично',
  warning: 'Внимание',
  info: 'Инфо'
}

export const DECISION_LABEL: Record<DecisionKind, string> = {
  keep: 'Оставить',
  remove_planned: 'Удалю',
  migrate: 'Перенесу',
  ignore_until: 'Скрыть до…'
}

export const STATUS_LABEL: Record<AuditStatus, string> = {
  collecting: 'Сбор данных…',
  analyzing: 'Анализ…',
  awaiting_confirmation: 'Ждёт подтверждения команд',
  done: 'Готово',
  failed: 'Ошибка'
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
