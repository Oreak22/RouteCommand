import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { resolveTheme, themeStorageKey } from './daisyui.config'
import type { ThemePreference } from './daisyui.config'
import { ThemeContext } from './theme-context'

const getInitialPreference = (): ThemePreference => {
  if (typeof window === 'undefined') return 'system'

  const stored = window.localStorage.getItem(themeStorageKey)
  return stored === 'dark' || stored === 'light' ? stored : 'system'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(getInitialPreference)
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () =>
      typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches,
  )

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const updateSystemPreference = (event: MediaQueryListEvent) =>
      setSystemPrefersDark(event.matches)

    media.addEventListener('change', updateSystemPreference)
    return () => media.removeEventListener('change', updateSystemPreference)
  }, [])

  const themeName = resolveTheme(preference, systemPrefersDark)

  useEffect(() => {
    document.documentElement.dataset.theme = themeName
  }, [themeName])

  const setPreference = (next: ThemePreference) => {
    window.localStorage.setItem(themeStorageKey, next)
    setPreferenceState(next)
  }

  const toggleTheme = () => {
    const current = preference === 'system' ? themeName : preference
    setPreference(current === 'dark' ? 'light' : 'dark')
  }

  return (
    <ThemeContext.Provider value={{ preference, themeName, setPreference, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
