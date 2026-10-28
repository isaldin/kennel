import { afterEach, describe, expect, it } from 'vitest'
import { getLang, setLang, t } from '../src/main/i18n'
import { DICTS, resolveLang, translate, type Message } from '../src/shared/i18n'
import { parsePrefs } from '../src/renderer/src/lib/prefs'

const forms = (m: Message): string[] => (typeof m === 'string' ? [m] : Object.values(m))
const placeholders = (m: Message): string[] =>
  [...new Set(forms(m).flatMap((f) => [...f.matchAll(/\{(\w+)\}/g)].map((x) => x[1])))].sort()

describe('translate', () => {
  it('fills placeholders and leaves unknown ones as is', () => {
    expect(translate('en', 'main.serverNotFound', { id: 7 })).toBe('Server 7 not found')
    expect(translate('ru', 'main.serverNotFound')).toBe('Сервер {id} не найден')
  })

  it('picks plural forms by count', () => {
    const en = (count: number): string =>
      translate('en', 'notify.newFindings', { count, title: 'x' })
    const ru = (count: number): string =>
      translate('ru', 'notify.newFindings', { count, title: 'x' })
    expect(en(1)).toBe('1 new problem: x')
    expect(en(3)).toBe('3 new problems: x')
    expect([ru(1), ru(3), ru(5), ru(21)]).toEqual([
      '1 новая проблема: x',
      '3 новые проблемы: x',
      '5 новых проблем: x',
      '21 новая проблема: x'
    ])
  })
})

describe('dictionaries', () => {
  it('use the same placeholders in every language', () => {
    for (const [key, message] of Object.entries(DICTS.en)) {
      expect(placeholders(DICTS.ru[key]), key).toEqual(placeholders(message))
    }
  })

  it('have no empty messages', () => {
    for (const dict of Object.values(DICTS)) {
      for (const [key, message] of Object.entries(dict)) {
        for (const form of forms(message)) expect(form.trim(), key).not.toBe('')
      }
    }
  })
})

describe('language choice', () => {
  afterEach(() => setLang('en'))

  it('follows a Russian OS locale and falls back to English', () => {
    expect(resolveLang('system', 'ru-RU')).toBe('ru')
    expect(resolveLang('system', 'de-DE')).toBe('en')
    expect(resolveLang('en', 'ru-RU')).toBe('en')
  })

  it('keeps a valid saved language and drops an unknown one', () => {
    expect(parsePrefs(null).language).toBe('system')
    expect(parsePrefs(JSON.stringify({ language: 'ru' })).language).toBe('ru')
    expect(parsePrefs(JSON.stringify({ language: 'fr' })).language).toBe('system')
  })

  it('switches main-process messages', () => {
    expect(t('main.claudeBusy')).toBe('Claude is still answering')
    setLang('ru')
    expect(getLang()).toBe('ru')
    expect(t('main.claudeBusy')).toBe('Claude ещё отвечает')
  })
})
