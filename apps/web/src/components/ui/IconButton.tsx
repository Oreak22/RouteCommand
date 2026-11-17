import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { Button } from './Button'
import type { ButtonSize, ButtonVariant } from './Button'

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  children: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
}

export function IconButton({ children, className = '', ...props }: IconButtonProps) {
  return (
    <Button className={`btn-square ${className}`.trim()} {...props}>
      {children}
    </Button>
  )
}
