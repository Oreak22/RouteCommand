import { Moon, Sun } from 'lucide-react'

import { useTheme } from './theme-context'
import { IconButton } from '../components/ui/IconButton'

export function ThemeToggle() {
  const { themeName, toggleTheme } = useTheme()
  const isDark = themeName === 'routecommand-dark'

  return (
    <IconButton
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} theme`}
      title={`Switch to ${isDark ? 'light' : 'dark'} theme`}
      onClick={toggleTheme}
      variant="ghost"
    >
      {isDark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </IconButton>
  )
}
