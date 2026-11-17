import { Check, Copy } from 'lucide-react'
import { useState } from 'react'

import { IconButton } from './IconButton'

type CopyButtonProps = { value: string; label?: string }

export function CopyButton({ value, label = 'Copy to clipboard' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <IconButton size="sm" variant="ghost" aria-label={copied ? 'Copied' : label} onClick={copy}>
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </IconButton>
  )
}
