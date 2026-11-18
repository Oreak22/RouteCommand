import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import '@fontsource-variable/inter'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'

import './index.css'
import './features/telemetry/pwa-install-prompt'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const apiBase = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'
    const workerUrl = `/sw.js?apiBase=${encodeURIComponent(apiBase)}`
    void navigator.serviceWorker.register(workerUrl).catch(() => undefined)
  })
}
