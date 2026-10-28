import { THEMES, resolveTheme, type Theme, type ThemeChoice } from './themes'

/** Per-machine look-and-feel settings, kept in localStorage. */
export interface Prefs {
  theme: ThemeChoice
  /** Page zoom factor for the whole interface. */
  zoom: number
  termFontSize: number
  termFontFamily: string
  cursorBlink: boolean
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'dark',
  zoom: 1,
  termFontSize: 13,
  termFontFamily: '"JetBrains Mono", "SF Mono", Menlo, monospace',
  cursorBlink: true
}

export const ZOOMS = [0.9, 1, 1.1, 1.25]
export const TERM_FONT_SIZES = [11, 12, 13, 14, 15, 16, 18]
export const TERM_FONTS: [string, string][] = [
  [DEFAULT_PREFS.termFontFamily, 'JetBrains Mono (или SF Mono)'],
  ['"SF Mono", Menlo, monospace', 'SF Mono'],
  ['Menlo, monospace', 'Menlo'],
  ['"Fira Code", Menlo, monospace', 'Fira Code'],
  ['Monaco, monospace', 'Monaco']
]

const KEY = 'prefs'

/** Reads saved prefs, dropping unknown or invalid values so a bad entry can't break the UI. */
export function parsePrefs(raw: string | null): Prefs {
  let saved: Partial<Prefs> = {}
  try {
    saved = (raw ? JSON.parse(raw) : {}) as Partial<Prefs>
  } catch {
    return DEFAULT_PREFS
  }
  const prefs = { ...DEFAULT_PREFS }
  if (saved.theme === 'system' || (saved.theme && saved.theme in THEMES)) prefs.theme = saved.theme
  if (saved.zoom && ZOOMS.includes(saved.zoom)) prefs.zoom = saved.zoom
  if (saved.termFontSize && TERM_FONT_SIZES.includes(saved.termFontSize)) {
    prefs.termFontSize = saved.termFontSize
  }
  if (TERM_FONTS.some(([value]) => value === saved.termFontFamily)) {
    prefs.termFontFamily = saved.termFontFamily!
  }
  if (typeof saved.cursorBlink === 'boolean') prefs.cursorBlink = saved.cursorBlink
  return prefs
}

export function loadPrefs(): Prefs {
  try {
    return parsePrefs(localStorage.getItem(KEY))
  } catch {
    return DEFAULT_PREFS
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // Storage unavailable: the choice still applies for this session.
  }
}

/** Puts the theme's colors on :root so every CSS rule picks them up. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  for (const [name, value] of Object.entries(theme.ui)) root.style.setProperty(`--${name}`, value)
  root.style.colorScheme = theme.scheme
  root.dataset.theme = theme.scheme
}

export const systemDark = (): boolean => window.matchMedia('(prefers-color-scheme: dark)').matches

export const currentTheme = (prefs: Prefs): Theme => resolveTheme(prefs.theme, systemDark())
