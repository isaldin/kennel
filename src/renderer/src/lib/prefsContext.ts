import { createContext, useContext } from 'react'
import type { Lang, T } from '../../../shared/i18n'
import type { Prefs } from './prefs'
import type { Theme } from './themes'

export interface PrefsContextValue {
  prefs: Prefs
  /** The theme in effect: the chosen one, or the OS-matching one for "system". */
  theme: Theme
  update(patch: Partial<Prefs>): void
  /** The language in effect: the chosen one, or the OS one for "system". */
  lang: Lang
  t: T
}

export const PrefsContext = createContext<PrefsContextValue | null>(null)

export function usePrefs(): PrefsContextValue {
  const ctx = useContext(PrefsContext)
  if (!ctx) throw new Error('PrefsProvider missing')
  return ctx
}

/** The translator for the current interface language. */
export function useT(): T {
  return usePrefs().t
}
