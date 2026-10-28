import type { Translation } from './types'

export const en = {
  'notify.awaitingConfirmation': 'The audit is waiting for you to confirm commands',
  'notify.newFindings': {
    one: '{count} new problem: {title}',
    other: '{count} new problems: {title}'
  },
  'main.auditRunning': 'This server is already being audited',
  'main.serverNotFound': 'Server {id} not found',
  'main.addedFromAudit': 'Added from the audit',
  'main.claudeBusy': 'Claude is still answering',
  'main.findingNotFound': 'This problem is not in the latest audit',
  'main.claudeNotFound': 'Claude CLI not found. Install Claude Code or set KENNEL_CLAUDE_BIN',
  'main.badPeriod': 'Invalid period: {hours}'
}

export const ru: Translation<typeof en> = {
  'notify.awaitingConfirmation': 'Проверка ждёт подтверждения команд',
  'notify.newFindings': {
    one: '{count} новая проблема: {title}',
    few: '{count} новые проблемы: {title}',
    many: '{count} новых проблем: {title}',
    other: '{count} новых проблем: {title}'
  },
  'main.auditRunning': 'Проверка этого сервера уже идёт',
  'main.serverNotFound': 'Сервер {id} не найден',
  'main.addedFromAudit': 'Добавлено из аудита',
  'main.claudeBusy': 'Claude ещё отвечает',
  'main.findingNotFound': 'Проблема не найдена в последнем аудите',
  'main.claudeNotFound':
    'Claude CLI не найден. Установите Claude Code или задайте KENNEL_CLAUDE_BIN',
  'main.badPeriod': 'Недопустимый период: {hours}'
}
