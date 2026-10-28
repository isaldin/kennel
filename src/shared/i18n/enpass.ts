import type { Translation } from './types'

export const en = {
  'enpass.unlockTitle': 'Unlock Enpass',
  'enpass.checking': 'Checking…',
  'enpass.unlock': 'Unlock',
  'enpass.readOnlyNote':
    'The vault is opened read-only. The master password stays in memory until you lock it or quit.',
  'enpass.masterPassword': 'Enpass master password',
  'enpass.vaultNotFound': 'Enpass vault not found.',
  'enpass.pickTitle': 'Choose an Enpass item',
  'enpass.searchPlaceholder': 'Search by title, login or URL',
  'enpass.noPassword': ' · no password',
  'enpass.nothingFound': 'Nothing found',
  'enpass.copied': 'Password copied, the clipboard clears in 30 s',
  'enpass.itemNotFound': 'item not found',
  'enpass.locked': 'Enpass is locked',
  'enpass.copyPassword': 'Copy password',
  'enpass.openUrl': 'Open URL',
  'enpass.change': 'Change',
  'enpass.unlink': 'Unlink',
  'enpass.link': 'Link Enpass item'
}

export const ru: Translation<typeof en> = {
  'enpass.unlockTitle': 'Разблокировать Enpass',
  'enpass.checking': 'Проверяю…',
  'enpass.unlock': 'Разблокировать',
  'enpass.readOnlyNote':
    'Хранилище открывается только на чтение. Мастер-пароль остаётся в памяти до блокировки или выхода.',
  'enpass.masterPassword': 'Мастер-пароль Enpass',
  'enpass.vaultNotFound': 'Хранилище Enpass не найдено.',
  'enpass.pickTitle': 'Выбрать запись Enpass',
  'enpass.searchPlaceholder': 'Поиск по названию, логину или URL',
  'enpass.noPassword': ' · без пароля',
  'enpass.nothingFound': 'Ничего не найдено',
  'enpass.copied': 'Пароль скопирован, буфер очистится через 30 с',
  'enpass.itemNotFound': 'запись не найдена',
  'enpass.locked': 'Enpass заблокирован',
  'enpass.copyPassword': 'Скопировать пароль',
  'enpass.openUrl': 'Открыть URL',
  'enpass.change': 'Сменить',
  'enpass.unlink': 'Отвязать',
  'enpass.link': 'Привязать запись Enpass'
}
