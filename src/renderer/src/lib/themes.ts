import type { ITheme } from '@xterm/xterm'

export type ThemeId = 'dark' | 'light' | 'nord' | 'solarized-light' | 'gruvbox'

export interface Theme {
  label: string
  scheme: 'dark' | 'light'
  /** CSS custom properties set on :root (without the leading `--`). */
  ui: Record<string, string>
  terminal: ITheme
}

export const THEMES: Record<ThemeId, Theme> = {
  dark: {
    label: 'Тёмная',
    scheme: 'dark',
    ui: {
      bg: '#14161a',
      'bg-elevated': '#1b1e24',
      'bg-hover': '#23272f',
      'bg-selected': '#2a3040',
      'bg-sunken': '#0f1115',
      border: '#2b2f38',
      'border-strong': '#3b4252',
      text: '#d8dee9',
      muted: '#8a93a6',
      accent: '#7aa2f7',
      'accent-text': '#0f1218',
      danger: '#f7768e',
      ok: '#9ece6a',
      warn: '#e0af68',
      overlay: 'rgba(0, 0, 0, 0.55)',
      shadow: 'rgba(0, 0, 0, 0.5)'
    },
    terminal: {
      background: '#14161a',
      foreground: '#d8dee9',
      cursor: '#7aa2f7',
      selectionBackground: '#3b4261',
      black: '#15161e',
      red: '#f7768e',
      green: '#9ece6a',
      yellow: '#e0af68',
      blue: '#7aa2f7',
      magenta: '#bb9af7',
      cyan: '#7dcfff',
      white: '#a9b1d6',
      brightBlack: '#565f89',
      brightRed: '#f7768e',
      brightGreen: '#9ece6a',
      brightYellow: '#e0af68',
      brightBlue: '#7aa2f7',
      brightMagenta: '#bb9af7',
      brightCyan: '#7dcfff',
      brightWhite: '#c0caf5'
    }
  },
  light: {
    label: 'Светлая',
    scheme: 'light',
    ui: {
      bg: '#f6f7f9',
      'bg-elevated': '#ffffff',
      'bg-hover': '#eceef2',
      'bg-selected': '#dde6f7',
      'bg-sunken': '#e9ebef',
      border: '#d6d9e0',
      'border-strong': '#b8bdc8',
      text: '#1f2328',
      muted: '#5f6773',
      accent: '#2f6fde',
      'accent-text': '#ffffff',
      danger: '#cf222e',
      ok: '#1a7f37',
      warn: '#9a6700',
      overlay: 'rgba(15, 20, 30, 0.35)',
      shadow: 'rgba(15, 20, 30, 0.18)'
    },
    terminal: {
      background: '#ffffff',
      foreground: '#1f2328',
      cursor: '#2f6fde',
      selectionBackground: '#c8daf8',
      black: '#24292f',
      red: '#cf222e',
      green: '#116329',
      yellow: '#7d4e00',
      blue: '#0969da',
      magenta: '#8250df',
      cyan: '#1b7c83',
      white: '#6e7781',
      brightBlack: '#57606a',
      brightRed: '#a40e26',
      brightGreen: '#1a7f37',
      brightYellow: '#633c01',
      brightBlue: '#218bff',
      brightMagenta: '#a475f9',
      brightCyan: '#3192aa',
      brightWhite: '#8c959f'
    }
  },
  nord: {
    label: 'Nord',
    scheme: 'dark',
    ui: {
      bg: '#2e3440',
      'bg-elevated': '#353b49',
      'bg-hover': '#3b4252',
      'bg-selected': '#434c5e',
      'bg-sunken': '#272c36',
      border: '#434c5e',
      'border-strong': '#4c566a',
      text: '#e5e9f0',
      muted: '#a0aabd',
      accent: '#88c0d0',
      'accent-text': '#2e3440',
      danger: '#bf616a',
      ok: '#a3be8c',
      warn: '#ebcb8b',
      overlay: 'rgba(0, 0, 0, 0.5)',
      shadow: 'rgba(0, 0, 0, 0.45)'
    },
    terminal: {
      background: '#2e3440',
      foreground: '#d8dee9',
      cursor: '#d8dee9',
      selectionBackground: '#4c566a',
      black: '#3b4252',
      red: '#bf616a',
      green: '#a3be8c',
      yellow: '#ebcb8b',
      blue: '#81a1c1',
      magenta: '#b48ead',
      cyan: '#88c0d0',
      white: '#e5e9f0',
      brightBlack: '#616e88',
      brightRed: '#bf616a',
      brightGreen: '#a3be8c',
      brightYellow: '#ebcb8b',
      brightBlue: '#81a1c1',
      brightMagenta: '#b48ead',
      brightCyan: '#8fbcbb',
      brightWhite: '#eceff4'
    }
  },
  'solarized-light': {
    label: 'Solarized светлая',
    scheme: 'light',
    ui: {
      bg: '#fdf6e3',
      'bg-elevated': '#fffbf0',
      'bg-hover': '#eee8d5',
      'bg-selected': '#e6dfc8',
      'bg-sunken': '#eee8d5',
      border: '#ddd6c1',
      'border-strong': '#c4bca2',
      text: '#073642',
      muted: '#5f7178',
      accent: '#268bd2',
      'accent-text': '#fdf6e3',
      danger: '#dc322f',
      ok: '#6c7c00',
      warn: '#a07800',
      overlay: 'rgba(0, 43, 54, 0.3)',
      shadow: 'rgba(0, 43, 54, 0.18)'
    },
    terminal: {
      background: '#fdf6e3',
      foreground: '#475b62',
      cursor: '#586e75',
      selectionBackground: '#e6dfc8',
      black: '#073642',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#93a1a1',
      brightBlack: '#002b36',
      brightRed: '#cb4b16',
      brightGreen: '#586e75',
      brightYellow: '#657b83',
      brightBlue: '#839496',
      brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1',
      brightWhite: '#eee8d5'
    }
  },
  gruvbox: {
    label: 'Gruvbox',
    scheme: 'dark',
    ui: {
      bg: '#282828',
      'bg-elevated': '#32302f',
      'bg-hover': '#3c3836',
      'bg-selected': '#504945',
      'bg-sunken': '#1d2021',
      border: '#3c3836',
      'border-strong': '#665c54',
      text: '#ebdbb2',
      muted: '#a89984',
      accent: '#83a598',
      'accent-text': '#282828',
      danger: '#fb4934',
      ok: '#b8bb26',
      warn: '#fabd2f',
      overlay: 'rgba(0, 0, 0, 0.55)',
      shadow: 'rgba(0, 0, 0, 0.5)'
    },
    terminal: {
      background: '#282828',
      foreground: '#ebdbb2',
      cursor: '#ebdbb2',
      selectionBackground: '#504945',
      black: '#282828',
      red: '#cc241d',
      green: '#98971a',
      yellow: '#d79921',
      blue: '#458588',
      magenta: '#b16286',
      cyan: '#689d6a',
      white: '#a89984',
      brightBlack: '#928374',
      brightRed: '#fb4934',
      brightGreen: '#b8bb26',
      brightYellow: '#fabd2f',
      brightBlue: '#83a598',
      brightMagenta: '#d3869b',
      brightCyan: '#8ec07c',
      brightWhite: '#ebdbb2'
    }
  }
}

/** A theme choice: a fixed theme, or follow the OS light/dark setting. */
export type ThemeChoice = ThemeId | 'system'

export function resolveTheme(choice: ThemeChoice, systemDark: boolean): Theme {
  if (choice === 'system') return THEMES[systemDark ? 'dark' : 'light']
  return THEMES[choice] ?? THEMES.dark
}
