import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Checkbox } from './Checkbox'
import { Combobox } from './Combobox'
import { FormField } from './FormField'
import { Input } from './Input'
import { PasswordInput } from './PasswordInput'
import { RadioGroup } from './RadioGroup'
import { SearchBar } from './SearchBar'
import { Select } from './Select'
import { Textarea } from './Textarea'
import { Toggle } from './Toggle'

describe('form controls', () => {
  it('exposes labels, validation, and suggestions across its field controls', async () => {
    const user = userEvent.setup()
    render(
      <>
        <FormField label="Dispatcher" hint="Choose the shift lead">
          <Combobox aria-label="Dispatcher" options={['Amara Okafor', 'Chidi Nwosu']} />
        </FormField>
        <FormField label="Email" error="Enter a valid email">
          <Input type="email" />
        </FormField>
        <PasswordInput aria-label="Password" />
        <Textarea aria-label="Delivery note" />
        <Select aria-label="Priority" defaultValue="normal">
          <option value="normal">Normal</option>
          <option value="urgent">Urgent</option>
        </Select>
        <SearchBar label="Search deliveries" />
        <Checkbox label="Keep me signed in" />
        <Toggle label="Share location" />
      </>,
    )

    const dispatcher = screen.getByRole('combobox', { name: 'Dispatcher' })
    expect(dispatcher).toHaveAttribute('aria-describedby')
    expect(document.querySelector('datalist option[value="Amara Okafor"]')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email')
    expect(screen.getByRole('searchbox', { name: 'Search deliveries' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Keep me signed in' })).not.toBeChecked()
    expect(screen.getByRole('switch', { name: 'Share location' })).not.toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(screen.getByRole('textbox', { name: 'Password' })).toHaveAttribute('type', 'text')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Priority' }), 'urgent')
    expect(screen.getByRole('combobox', { name: 'Priority' })).toHaveValue('urgent')
    await user.click(screen.getByRole('checkbox', { name: 'Keep me signed in' }))
    expect(screen.getByRole('checkbox', { name: 'Keep me signed in' })).toBeChecked()
    await user.click(screen.getByRole('switch', { name: 'Share location' }))
    expect(screen.getByRole('switch', { name: 'Share location' })).toBeChecked()
  })

  it('reports a selected radio option and preserves disabled options', () => {
    const onChange = vi.fn()
    render(
      <RadioGroup
        name="map-layer"
        label="Map layer"
        value="street"
        onChange={onChange}
        options={[
          { value: 'street', label: 'Street map' },
          { value: 'satellite', label: 'Satellite' },
          { value: 'offline', label: 'Offline map', disabled: true },
        ]}
      />,
    )

    expect(screen.getByRole('radio', { name: 'Street map' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Offline map' })).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: 'Satellite' }))
    expect(onChange).toHaveBeenCalledWith('satellite')
  })
})
