import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ConfirmDialog } from './ConfirmDialog'
import { CopyButton } from './CopyButton'
import { Drawer } from './Drawer'
import { Dropdown } from './Dropdown'
import { ErrorState } from './ErrorState'
import { Modal } from './Modal'
import { Pagination } from './Pagination'
import { Toast, ToastProvider } from './Toast'
import { useToast } from './toast-context'

const originalShowModal = HTMLDialogElement.prototype.showModal
const originalClose = HTMLDialogElement.prototype.close

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})

afterEach(() => {
  HTMLDialogElement.prototype.showModal = originalShowModal
  HTMLDialogElement.prototype.close = originalClose
})

describe('interaction primitives', () => {
  it('opens and closes a modal with its accessible close control', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="Route details" description="Current route">
        Route information
      </Modal>,
    )

    expect(screen.getByRole('dialog', { name: 'Route details' })).toHaveAttribute('open')
    expect(screen.getByText('Current route')).toBeInTheDocument()
    const dialog = screen.getByRole('dialog', { name: 'Route details' })
    const dialogContent = dialog.querySelector('section')
    expect(dialogContent).not.toBeNull()
    await user.click(within(dialogContent!).getByRole('button', { name: 'Close dialog' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('confirms a destructive action and closes a drawer from its backdrop', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const { rerender } = render(
      <ConfirmDialog
        open
        title="Remove driver"
        message="This cannot be undone."
        confirmLabel="Remove"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onConfirm).toHaveBeenCalledOnce()

    rerender(
      <Drawer open onClose={onCancel} title="Navigation">
        Route links
      </Drawer>,
    )
    expect(screen.getByRole('complementary', { name: 'Navigation' })).toHaveTextContent(
      'Route links',
    )
    await user.click(screen.getByRole('button', { name: 'Close navigation drawer' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('selects dropdown actions and changes pages within bounds', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onPageChange = vi.fn()
    render(
      <>
        <Dropdown
          label="Actions"
          items={[
            { label: 'Export', onSelect },
            { label: 'Delete', onSelect, disabled: true },
          ]}
        />
        <Pagination currentPage={2} pageCount={3} onPageChange={onPageChange} />
      </>,
    )

    await user.click(screen.getByRole('button', { name: 'Actions' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeDisabled()
    await user.click(screen.getByRole('menuitem', { name: 'Export' }))
    expect(onSelect).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(onPageChange).toHaveBeenCalledWith(3)
    expect(
      screen.getByText(
        (_, element) => element?.tagName === 'P' && element.textContent === 'Page 2 of 3',
      ),
    ).toBeInTheDocument()
  })

  it('surfaces an error retry and dismissible toast actions', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    const onDismiss = vi.fn()
    render(
      <>
        <ErrorState description="The map is unavailable." onRetry={onRetry} />
        <Toast message="Route saved" tone="success" onDismiss={onDismiss} />
      </>,
    )

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(onRetry).toHaveBeenCalledOnce()
    expect(onDismiss).toHaveBeenCalledOnce()
    expect(screen.getByRole('alert')).toHaveTextContent('The map is unavailable.')
  })

  it('copies a value and announces success', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    render(<CopyButton value="RC-4826-91" />)

    await user.click(screen.getByRole('button', { name: 'Copy to clipboard' }))
    expect(writeText).toHaveBeenCalledWith('RC-4826-91')
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('announces notifications emitted from the toast provider', async () => {
    const user = userEvent.setup()
    function ToastTrigger() {
      const { pushToast } = useToast()
      return <button onClick={() => pushToast('Driver connected', 'info')}>Notify</button>
    }

    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Notify' }))
    expect(screen.getByText('Driver connected')).toBeInTheDocument()
  })

  it('closes a modal from Escape', () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="Details">
        Body
      </Modal>,
    )
    fireEvent(
      screen.getByRole('dialog', { name: 'Details' }),
      new Event('cancel', { bubbles: true, cancelable: true }),
    )
    expect(onClose).toHaveBeenCalledOnce()
  })
})
