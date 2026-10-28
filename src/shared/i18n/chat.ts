import type { Translation } from './types'

export const en = {
  'chat.starter.what': 'What is this and what is it for?',
  'chat.starter.fix': 'How do I fix this?',
  'chat.starter.remove': 'How do I stop or remove it?',
  'chat.command.ran': 'ran',
  'chat.command.declined': 'declined',
  'chat.command.rejected': 'not in the allowlist',
  'chat.copy': 'Copy',
  'chat.copied': 'Copied',
  'chat.header': 'Discussion with Claude · {server}',
  'chat.toTerminalHint': "Go to this chat's terminal",
  'chat.openTerminalHint': 'Open an SSH terminal to this server next to the chat',
  'chat.toTerminal': 'To terminal',
  'chat.openTerminal': 'Open terminal',
  'chat.intro':
    'Claude sees this finding and the server snapshot. It may ask to read logs or configs (you confirm each command), but it never changes anything on the server.',
  'chat.awaitingConfirmation': 'Waiting for command confirmation…',
  'chat.thinking': 'Claude is thinking…',
  'chat.stop': 'Stop',
  'chat.placeholder': 'Ask about this finding… (Enter to send, Shift+Enter for a new line)',
  'chat.send': 'Send'
}

export const ru: Translation<typeof en> = {
  'chat.starter.what': 'Что это и зачем оно нужно?',
  'chat.starter.fix': 'Как это исправить?',
  'chat.starter.remove': 'Как остановить или удалить?',
  'chat.command.ran': 'выполнено',
  'chat.command.declined': 'отклонено',
  'chat.command.rejected': 'не из allowlist',
  'chat.copy': 'Копировать',
  'chat.copied': 'Скопировано',
  'chat.header': 'Обсуждение с Claude · {server}',
  'chat.toTerminalHint': 'Перейти в терминал этого чата',
  'chat.openTerminalHint': 'Открыть SSH-терминал этого сервера рядом с чатом',
  'chat.toTerminal': 'К терминалу',
  'chat.openTerminal': 'Открыть терминал',
  'chat.intro':
    'Claude видит эту проблему и снимок сервера. Он может попросить прочитать логи или конфиги (ты подтверждаешь каждую команду), но сам ничего на сервере не меняет.',
  'chat.awaitingConfirmation': 'Ждёт подтверждения команд…',
  'chat.thinking': 'Claude думает…',
  'chat.stop': 'Остановить',
  'chat.placeholder': 'Спроси про эту проблему… (Enter — отправить, Shift+Enter — новая строка)',
  'chat.send': 'Отправить'
}
