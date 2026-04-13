import React, { useContext } from 'react'

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
}

export const ThemeContext = React.createContext<Theme>(darkTheme)

export function useTheme(): Theme {
  return useContext(ThemeContext)
}

export function ThemeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  return React.createElement(ThemeContext.Provider, { value: darkTheme }, children)
}
