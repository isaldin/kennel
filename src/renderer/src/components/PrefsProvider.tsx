import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { applyTheme, loadPrefs, savePrefs, systemDark, type Prefs } from '../lib/prefs'
import { PrefsContext } from '../lib/prefsContext'
import { resolveTheme } from '../lib/themes'

export function PrefsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [prefs, setPrefs] = useState(loadPrefs)
  const [dark, setDark] = useState(systemDark)

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => setDark(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const theme = resolveTheme(prefs.theme, dark)
  useEffect(() => applyTheme(theme), [theme])
  useEffect(() => window.api.setZoom(prefs.zoom), [prefs.zoom])

  const value = useMemo(
    () => ({
      prefs,
      theme,
      update: (patch: Partial<Prefs>) =>
        setPrefs((current) => {
          const next = { ...current, ...patch }
          savePrefs(next)
          return next
        })
    }),
    [prefs, theme]
  )
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>
}
