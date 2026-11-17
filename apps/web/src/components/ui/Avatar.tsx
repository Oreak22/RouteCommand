import type { ImgHTMLAttributes } from 'react'

type AvatarProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'alt'> & {
  name: string
  size?: 'sm' | 'md' | 'lg'
}

const sizes = { sm: 'w-8', md: 'w-10', lg: 'w-14' } as const

const getInitials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?'

export function Avatar({ name, src, size = 'md', className = '', ...props }: AvatarProps) {
  return (
    <div className={`avatar placeholder ${className}`.trim()}>
      <div
        className={`${sizes[size]} aspect-square overflow-hidden rounded-full bg-neutral text-neutral-content`}
      >
        {src ? (
          <img src={src} alt={name} {...props} />
        ) : (
          <span aria-label={name}>{getInitials(name)}</span>
        )}
      </div>
    </div>
  )
}
