import { createContext, useContext } from 'react'
import type { Prefs } from './prefs'
import type { Theme } from './themes'

export interface PrefsContextValue {
  prefs: Prefs
  /** The theme in effect: the chosen one, or the OS-matching one for "system". */
  theme: Theme
  update(patch: Partial<Prefs>): void
}

export const PrefsContext = createContext<PrefsContextValue | null>(null)

export function usePrefs(): PrefsContextValue {
  const ctx = useContext(PrefsContext)
  if (!ctx) throw new Error('PrefsProvider missing')
  return ctx
}
