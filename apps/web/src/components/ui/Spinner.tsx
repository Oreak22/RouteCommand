type SpinnerProps = {
  size?: 'sm' | 'md' | 'lg'
  label?: string
}

const sizes = { sm: 'loading-xs', md: 'loading-md', lg: 'loading-lg' } as const

export function Spinner({ size = 'md', label = 'Loading' }: SpinnerProps) {
  return (
    <span className={`loading loading-spinner ${sizes[size]}`} role="status" aria-label={label} />
  )
}
