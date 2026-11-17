export const themeNames = {
  dark: 'routecommand-dark',
  light: 'routecommand-light',
} as const

export type ThemeName = (typeof themeNames)[keyof typeof themeNames]
export type ThemePreference = 'system' | 'dark' | 'light'

export const themeStorageKey = 'routecommand-theme'

export const resolveTheme = (
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ThemeName => {
  if (preference === 'system') {
    return systemPrefersDark ? themeNames.dark : themeNames.light
  }

  return preference === 'dark' ? themeNames.dark : themeNames.light
}
