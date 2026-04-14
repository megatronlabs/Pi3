import React, { useContext } from 'react'

export type BorderStyle = 'single' | 'double' | 'round' | 'bold' | 'classic'

export interface Theme {
  // Text colors
  primary: string
  secondary: string
  muted: string
  accent: string
  error: string
  warning: string
  success: string

  // Role colors
  user: string
  assistant: string
  tool: string
  thinking: string

  // UI chrome
  border: string
  statusBg: string
  inputBorder: string

  // Layout
  borderStyle: BorderStyle
}

export const darkTheme: Theme = {
  primary: 'white',
  secondary: 'gray',
  muted: '#555555',
  accent: '#7aa2f7',
  error: '#f7768e',
  warning: '#e0af68',
  success: '#9ece6a',
  user: '#7aa2f7',
  assistant: '#9ece6a',
  tool: '#e0af68',
  thinking: '#bb9af7',
  border: '#3b4261',
  statusBg: '#1a1b26',
  inputBorder: '#3b4261',
  borderStyle: 'single',
}

export const lightTheme: Theme = {
  primary: '#3b4261',
  secondary: '#565f89',
  muted: '#9aa5ce',
  accent: '#2f5af5',
  error: '#c0392b',
  warning: '#d4851a',
  success: '#2d6a2d',
  user: '#2f5af5',
  assistant: '#2d6a2d',
  tool: '#d4851a',
  thinking: '#7c4dbc',
  border: '#d5d6db',
  statusBg: '#f0f0f4',
  inputBorder: '#d5d6db',
  borderStyle: 'single',
}

export const draculaTheme: Theme = {
  primary: '#f8f8f2',
  secondary: '#bd93f9',
  muted: '#6272a4',
  accent: '#ff79c6',
  error: '#ff5555',
  warning: '#ffb86c',
  success: '#50fa7b',
  user: '#8be9fd',
  assistant: '#50fa7b',
  tool: '#ffb86c',
  thinking: '#bd93f9',
  border: '#44475a',
  statusBg: '#282a36',
  inputBorder: '#6272a4',
  borderStyle: 'single',
}

export const catppuccinTheme: Theme = {
  primary: '#cdd6f4',
  secondary: '#a6adc8',
  muted: '#585b70',
  accent: '#89b4fa',
  error: '#f38ba8',
  warning: '#fab387',
  success: '#a6e3a1',
  user: '#89b4fa',
  assistant: '#a6e3a1',
  tool: '#fab387',
  thinking: '#cba6f7',
  border: '#313244',
  statusBg: '#1e1e2e',
  inputBorder: '#45475a',
  borderStyle: 'round',
}

export const nordTheme: Theme = {
  primary: '#eceff4',
  secondary: '#d8dee9',
  muted: '#4c566a',
  accent: '#88c0d0',
  error: '#bf616a',
  warning: '#ebcb8b',
  success: '#a3be8c',
  user: '#81a1c1',
  assistant: '#a3be8c',
  tool: '#ebcb8b',
  thinking: '#b48ead',
  border: '#3b4252',
  statusBg: '#2e3440',
  inputBorder: '#3b4252',
  borderStyle: 'single',
}

export const gruvboxTheme: Theme = {
  primary: '#ebdbb2',
  secondary: '#d5c4a1',
  muted: '#665c54',
  accent: '#83a598',
  error: '#fb4934',
  warning: '#fabd2f',
  success: '#b8bb26',
  user: '#83a598',
  assistant: '#b8bb26',
  tool: '#fabd2f',
  thinking: '#d3869b',
  border: '#504945',
  statusBg: '#282828',
  inputBorder: '#504945',
  borderStyle: 'single',
}

export const THEMES: Record<string, Theme> = {
  dark: darkTheme,
  light: lightTheme,
  dracula: draculaTheme,
  catppuccin: catppuccinTheme,
  nord: nordTheme,
  gruvbox: gruvboxTheme,
}

export function getTheme(name: string): Theme {
  return THEMES[name] ?? darkTheme
}

export function applyThemeOverrides(base: Theme, overrides: Partial<Theme>): Theme {
  return { ...base, ...overrides }
}

export const ThemeContext = React.createContext<Theme>(darkTheme)

export function useTheme(): Theme {
  return useContext(ThemeContext)
}

export function ThemeProvider({
  theme = darkTheme,
  children,
}: {
  theme?: Theme
  children: React.ReactNode
}): React.JSX.Element {
  // Spread into a new object every render so React always sees a changed
  // context value and re-renders all useTheme() consumers.
  const value = React.useMemo(() => ({ ...theme }), [theme])
  return React.createElement(ThemeContext.Provider, { value }, children)
}
