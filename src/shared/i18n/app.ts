import type { Translation } from './types'

export const en = {
  'app.serversTab': 'Servers',
  'app.search': 'Search',
  'app.noProject': 'No project',
  'app.noServers': 'No servers yet. Add one or import from ~/.ssh/config.',
  'app.perMonth': '{amount} / mo',
  'app.noCost': 'No cost set',
  'app.addServer': '+ Server',
  'app.import': 'Import',
  'app.settingsHint': 'Settings (⌘,)',
  'app.enpassOpen': 'Enpass unlocked',
  'app.enpassLock': 'lock',
  'app.enpassUnlock': 'unlock',
  'app.enpassNotFound': 'Enpass not found',
  'app.pickServer': 'Pick a server on the left',
  'app.resizeHint': 'Drag to resize',
  'app.awaitingConfirmation': 'Waiting for command confirmation',
  'app.claudeAnswering': 'Claude is answering',
  'app.hasTerminal': 'Has its own terminal',
  'app.closeChat': 'Close chat',
  'app.newServer': 'New server'
}

export const ru: Translation<typeof en> = {
  'app.serversTab': 'Серверы',
  'app.search': 'Поиск',
  'app.noProject': 'Без проекта',
  'app.noServers': 'Серверов пока нет. Добавь вручную или импортируй из ~/.ssh/config.',
  'app.perMonth': '{amount} / мес',
  'app.noCost': 'Стоимость не указана',
  'app.addServer': '+ Сервер',
  'app.import': 'Импорт',
  'app.settingsHint': 'Настройки (⌘,)',
  'app.enpassOpen': 'Enpass открыт',
  'app.enpassLock': 'заблокировать',
  'app.enpassUnlock': 'разблокировать',
  'app.enpassNotFound': 'Enpass не найден',
  'app.pickServer': 'Выбери сервер слева',
  'app.resizeHint': 'Потяни, чтобы изменить ширину',
  'app.awaitingConfirmation': 'Ждёт подтверждения команд',
  'app.claudeAnswering': 'Claude отвечает',
  'app.hasTerminal': 'Есть свой терминал',
  'app.closeChat': 'Закрыть чат',
  'app.newServer': 'Новый сервер'
}
