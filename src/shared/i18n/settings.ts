import type { Translation } from './types'

export const en = {
  'settings.title': 'Settings',
  'settings.done': 'Done',
  'settings.language': 'Language',
  'settings.languageSystem': 'System',
  'settings.theme': 'Theme',
  'settings.themeSystem': 'System',
  'settings.theme.dark': 'Dark',
  'settings.theme.light': 'Light',
  'settings.theme.nord': 'Nord',
  'settings.theme.solarized-light': 'Solarized light',
  'settings.theme.gruvbox': 'Gruvbox',
  'settings.zoom': 'Interface zoom',
  'settings.terminal': 'Terminal',
  'settings.font': 'Font',
  'settings.fontSize': 'Font size',
  'settings.cursorBlink': 'Blinking cursor',
  'settings.audit': 'Audit',
  'settings.autoAudit': 'Automatic re-audit',
  'settings.autoAudit.0': 'Off',
  'settings.autoAudit.6': 'Every 6 hours',
  'settings.autoAudit.12': 'Every 12 hours',
  'settings.autoAudit.24': 'Daily',
  'settings.autoAudit.168': 'Weekly',
  'settings.thresholds': 'Rule thresholds…',
  'settings.autoAuditHint':
    'Automatic audits run while the app is open, and only for servers you have audited by hand at least once.'
}

export const ru: Translation<typeof en> = {
  'settings.title': 'Настройки',
  'settings.done': 'Готово',
  'settings.language': 'Язык',
  'settings.languageSystem': 'Как в системе',
  'settings.theme': 'Тема',
  'settings.themeSystem': 'Как в системе',
  'settings.theme.dark': 'Тёмная',
  'settings.theme.light': 'Светлая',
  'settings.theme.nord': 'Nord',
  'settings.theme.solarized-light': 'Solarized светлая',
  'settings.theme.gruvbox': 'Gruvbox',
  'settings.zoom': 'Масштаб интерфейса',
  'settings.terminal': 'Терминал',
  'settings.font': 'Шрифт',
  'settings.fontSize': 'Размер шрифта',
  'settings.cursorBlink': 'Мигающий курсор',
  'settings.audit': 'Аудит',
  'settings.autoAudit': 'Автоматическая перепроверка',
  'settings.autoAudit.0': 'Выключена',
  'settings.autoAudit.6': 'Каждые 6 часов',
  'settings.autoAudit.12': 'Каждые 12 часов',
  'settings.autoAudit.24': 'Раз в день',
  'settings.autoAudit.168': 'Раз в неделю',
  'settings.thresholds': 'Пороги правил…',
  'settings.autoAuditHint':
    'Автопроверка идёт, пока приложение открыто, и только для серверов, которые ты уже хотя бы раз проверил вручную.'
}
