import { useState } from 'react'
import type { FormEvent } from 'react'

import { Button } from '../../../components/ui/Button'
import { FormField } from '../../../components/ui/FormField'
import { Input } from '../../../components/ui/Input'
import { Modal } from '../../../components/ui/Modal'
import { useToast } from '../../../components/ui/toast-context'
import { fleetApi } from '../api/client'
import { useFleetMutation } from '../api/hooks'

export function DriverForm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [licenseNo, setLicenseNo] = useState('')
  const [password, setPassword] = useState('')
  const { pushToast } = useToast()
  const create = useFleetMutation(
    (input: { name: string; email: string; phone?: string; licenseNo: string; password: string }) =>
      fleetApi.createDriver(input),
    [['drivers']],
  )

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      await create.mutateAsync({
        name: name.trim(),
        email: email.trim(),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        licenseNo: licenseNo.trim(),
        password,
      })
      pushToast('Driver account created. Email verification instructions were queued.', 'success')
      setName('')
      setEmail('')
      setPhone('')
      setLicenseNo('')
      setPassword('')
      onClose()
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not create driver.', 'error')
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add driver"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button form="driver-form" type="submit" loading={create.isPending}>
            Create driver
          </Button>
        </>
      }
    >
      <form id="driver-form" className="space-y-4" onSubmit={(event) => void submit(event)}>
        <p className="text-sm text-base-content/60">
          The driver will receive an email verification link. The password is temporary and should
          be shared securely.
        </p>
        <FormField label="Full name" required>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            required
            maxLength={120}
          />
        </FormField>
        <FormField label="Email" required>
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
            maxLength={254}
          />
        </FormField>
        <FormField label="Phone">
          <Input
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            autoComplete="tel"
            maxLength={40}
          />
        </FormField>
        <FormField label="License number" required>
          <Input
            value={licenseNo}
            onChange={(event) => setLicenseNo(event.target.value)}
            required
            maxLength={80}
          />
        </FormField>
        <FormField label="Temporary password" hint="At least 10 characters." required>
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            minLength={10}
            maxLength={128}
            required
          />
        </FormField>
      </form>
    </Modal>
  )
}
