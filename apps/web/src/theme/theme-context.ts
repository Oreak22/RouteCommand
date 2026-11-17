import { createContext, useContext } from 'react'

import type { ThemeName, ThemePreference } from './daisyui.config'

export type ThemeContextValue = {
  preference: ThemePreference
  themeName: ThemeName
  setPreference: (preference: ThemePreference) => void
  toggleTheme: () => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

export const useTheme = (): ThemeContextValue => {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used within ThemeProvider')
  return value
}
