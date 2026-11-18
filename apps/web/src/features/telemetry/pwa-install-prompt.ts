import { useSyncExternalStore } from 'react'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

let installPrompt: InstallPromptEvent | null = null
const subscribers = new Set<() => void>()

function publishPrompt(prompt: InstallPromptEvent | null) {
  installPrompt = prompt
  subscribers.forEach((subscriber) => subscriber())
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    publishPrompt(event as InstallPromptEvent)
  })
  window.addEventListener('appinstalled', () => publishPrompt(null))
}

export function usePwaInstallPrompt() {
  return useSyncExternalStore(
    (subscriber) => {
      subscribers.add(subscriber)
      return () => subscribers.delete(subscriber)
    },
    () => installPrompt,
    () => null,
  )
}

export async function promptPwaInstall(prompt: InstallPromptEvent) {
  await prompt.prompt()
  const choice = await prompt.userChoice
  publishPrompt(null)
  return choice.outcome
}
