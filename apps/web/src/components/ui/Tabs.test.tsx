import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { Tabs } from './Tabs'

describe('Tabs', () => {
  it('changes the selected panel on click and arrow navigation', async () => {
    const user = userEvent.setup()
    render(
      <Tabs
        label="Map display"
        items={[
          { id: 'street', label: 'Street', content: 'Street layer' },
          { id: 'satellite', label: 'Satellite', content: 'Satellite layer' },
        ]}
      />,
    )

    await user.click(screen.getByRole('tab', { name: 'Satellite' }))
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Satellite layer')
    expect(screen.getByRole('tab', { name: 'Satellite' })).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Street layer')
  })
})
