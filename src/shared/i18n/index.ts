import * as app from './app'
import * as audit from './audit'
import * as chat from './chat'
import * as common from './common'
import * as enpass from './enpass'
import * as main from './main'
import * as rules from './rules'
import * as server from './server'
import * as settings from './settings'
import type { Dict, Message } from './types'

export type { Message, Plural } from './types'

export type Lang = 'en' | 'ru'
/** What the user picked in settings; "system" follows the OS language. */
export type LangChoice = Lang | 'system'

export const LANGS: Lang[] = ['en', 'ru']

/** BCP 47 locale for Intl formatting in each language. */
export const LOCALES: Record<Lang, string> = { en: 'en-US', ru: 'ru-RU' }

const en = {
  ...app.en,
  ...audit.en,
  ...chat.en,
  ...common.en,
  ...enpass.en,
  ...main.en,
  ...rules.en,
  ...server.en,
  ...settings.en
}
const ru: Record<keyof typeof en, Message> = {
  ...app.ru,
  ...audit.ru,
  ...chat.ru,
  ...common.ru,
  ...enpass.ru,
  ...main.ru,
  ...rules.ru,
  ...server.ru,
  ...settings.ru
}

export type MessageKey = keyof typeof en
export type Params = Record<string, string | number>
export type T = (key: MessageKey, params?: Params) => string

/** All dictionaries; exported for the consistency test. */
export const DICTS: Record<Lang, Dict> = { en, ru }

/** Russian for a Russian OS locale, English for everything else. */
export function resolveLang(choice: LangChoice, locale: string): Lang {
  if (choice !== 'system') return choice
  return locale.toLowerCase().startsWith('ru') ? 'ru' : 'en'
}

export function isLang(value: unknown): value is Lang {
  return LANGS.includes(value as Lang)
}

export function translate(lang: Lang, key: MessageKey, params?: Params): string {
  let message = DICTS[lang][key] ?? en[key]
  if (typeof message !== 'string') {
    const category = new Intl.PluralRules(LOCALES[lang]).select(Number(params?.count ?? 0))
    message = message[category as keyof typeof message] ?? message.other
  }
  return message.replace(/\{(\w+)\}/g, (match, name: string) =>
    params && name in params ? String(params[name]) : match
  )
}

export const translator =
  (lang: Lang): T =>
  (key, params) =>
    translate(lang, key, params)
