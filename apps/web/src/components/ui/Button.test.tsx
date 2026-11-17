import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Button } from './Button'

describe('Button', () => {
  it('shows a busy state and prevents a second submission while loading', () => {
    render(<Button loading>Save changes</Button>)

    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true')
  })
})
