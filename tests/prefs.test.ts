import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFS, parsePrefs } from '../src/renderer/src/lib/prefs'
import { THEMES, resolveTheme } from '../src/renderer/src/lib/themes'

describe('parsePrefs', () => {
  it('falls back to defaults for missing or broken data', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS)
    expect(parsePrefs('{nope')).toEqual(DEFAULT_PREFS)
  })

  it('keeps valid values and drops unknown ones', () => {
    const prefs = parsePrefs(
      JSON.stringify({ theme: 'light', zoom: 1.1, termFontSize: 99, termFontFamily: 'Comic Sans' })
    )
    expect(prefs).toEqual({ ...DEFAULT_PREFS, theme: 'light', zoom: 1.1 })
    expect(parsePrefs(JSON.stringify({ theme: 'neon' })).theme).toBe('dark')
    expect(parsePrefs(JSON.stringify({ theme: 'system', cursorBlink: false }))).toMatchObject({
      theme: 'system',
      cursorBlink: false
    })
  })
})

describe('themes', () => {
  it('follows the OS setting for "system"', () => {
    expect(resolveTheme('system', true)).toBe(THEMES.dark)
    expect(resolveTheme('system', false)).toBe(THEMES.light)
    expect(resolveTheme('nord', false)).toBe(THEMES.nord)
  })

  it('defines every color token in every theme', () => {
    const tokens = Object.keys(THEMES.dark.ui).sort()
    for (const theme of Object.values(THEMES)) {
      expect(Object.keys(theme.ui).sort()).toEqual(tokens)
      expect(Object.keys(theme.terminal)).toHaveLength(20) // 4 base colors + 16 ANSI
    }
  })
})
