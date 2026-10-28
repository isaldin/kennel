import { translate, type Lang, type T } from '../shared/i18n'

/** The interface language, set by the renderer; main uses it for rule findings, errors and Claude replies. */
let current: Lang = 'en'

export const getLang = (): Lang => current

export function setLang(lang: Lang): void {
  current = lang
}

export const t: T = (key, params) => translate(current, key, params)
