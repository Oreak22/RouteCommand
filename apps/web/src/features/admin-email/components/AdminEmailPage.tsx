import { useState } from 'react'

import { PageHeader } from '../../../components/common/PageHeader'
import { Badge } from '../../../components/ui/Badge'
import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { EmptyState } from '../../../components/ui/EmptyState'
import { ErrorState } from '../../../components/ui/ErrorState'
import { Spinner } from '../../../components/ui/Spinner'
import type { EmailLogStatus } from '../api/client'
import {
  useAdminEmailLogs,
  useClearEmailSuppression,
  useEmailSuppressions,
  useRetryEmail,
} from '../api/hooks'

const statusFilters: { label: string; value: EmailLogStatus | undefined }[] = [
  { label: 'All', value: undefined },
  { label: 'Failed', value: 'FAILED' },
  { label: 'Bounced', value: 'BOUNCED' },
  { label: 'Suppressed', value: 'SUPPRESSED' },
  { label: 'Sent', value: 'SENT' },
]

function readable(value: string) {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function timestamp(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  )
}

export function AdminEmailPage() {
  const [tab, setTab] = useState<'logs' | 'suppressions'>('logs')
  const [status, setStatus] = useState<EmailLogStatus | undefined>('FAILED')
  const [recipientInput, setRecipientInput] = useState('')
  const [recipient, setRecipient] = useState('')
  const logs = useAdminEmailLogs({
    ...(status ? { status } : {}),
    ...(recipient ? { recipient } : {}),
  })
  const suppressions = useEmailSuppressions()
  const retry = useRetryEmail()
  const clear = useClearEmailSuppression()
  const suppressedEmails = new Set(suppressions.data?.map((entry) => entry.email.toLowerCase()))

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Email delivery"
        description="Review delivery outcomes, retry eligible messages, and manage suppressed addresses. SENT means the SMTP server accepted the message."
      />
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Email administration views">
        <Button
          role="tab"
          aria-selected={tab === 'logs'}
          variant={tab === 'logs' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => setTab('logs')}
        >
          Delivery log
        </Button>
        <Button
          role="tab"
          aria-selected={tab === 'suppressions'}
          variant={tab === 'suppressions' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => setTab('suppressions')}
        >
          Suppressions {suppressions.data ? `(${suppressions.data.length})` : ''}
        </Button>
      </div>

      {tab === 'logs' ? (
        <Card>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter email status">
              {statusFilters.map((filter) => (
                <Button
                  key={filter.label}
                  size="sm"
                  variant={status === filter.value ? 'primary' : 'secondary'}
                  aria-pressed={status === filter.value}
                  onClick={() => setStatus(filter.value)}
                >
                  {filter.label}
                </Button>
              ))}
            </div>
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault()
                setRecipient(recipientInput.trim())
              }}
            >
              <label className="form-control w-full max-w-md">
                <span className="label-text mb-1 text-xs">Recipient email contains</span>
                <input
                  className="input input-bordered w-full"
                  type="search"
                  value={recipientInput}
                  onChange={(event) => setRecipientInput(event.target.value)}
                  placeholder="name@example.com"
                />
              </label>
              <div className="flex items-end gap-2">
                <Button size="sm" type="submit">
                  Search
                </Button>
                {recipient && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setRecipient('')
                      setRecipientInput('')
                    }}
                  >
                    Clear
                  </Button>
                )}
              </div>
            </form>

            {logs.isLoading ? (
              <div className="grid min-h-40 place-items-center">
                <Spinner label="Loading email logs" />
              </div>
            ) : logs.isError ? (
              <ErrorState
                title="Email logs could not be loaded"
                description={logs.error.message}
                onRetry={() => void logs.refetch()}
              />
            ) : logs.data?.data.length ? (
              <div className="overflow-x-auto rounded-box border border-base-content/10">
                <table className="table table-zebra">
                  <thead>
                    <tr>
                      <th>Recipient</th>
                      <th>Template</th>
                      <th>Status</th>
                      <th>Attempts</th>
                      <th>Queued</th>
                      <th>Details</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.data.data.map((row) => {
                      const isSuppressed = suppressedEmails.has(row.recipientEmail.toLowerCase())
                      const retryable = ['FAILED', 'BOUNCED'].includes(row.status) && !isSuppressed
                      return (
                        <tr key={row.id}>
                          <td className="max-w-56 truncate">{row.recipientEmail}</td>
                          <td>{readable(row.template)}</td>
                          <td>
                            <Badge
                              tone={
                                row.status === 'SENT'
                                  ? 'success'
                                  : row.status === 'FAILED' || row.status === 'BOUNCED'
                                    ? 'error'
                                    : 'warning'
                              }
                            >
                              {readable(row.status)}
                            </Badge>
                          </td>
                          <td>{row.attempts}</td>
                          <td className="whitespace-nowrap">{timestamp(row.queuedAt)}</td>
                          <td className="max-w-64 text-xs text-base-content/65">
                            {isSuppressed
                              ? 'Recipient suppressed; clear it before retry.'
                              : (row.lastError ?? row.providerMessageId ?? '—')}
                          </td>
                          <td>
                            {retryable && (
                              <Button
                                size="sm"
                                loading={retry.isPending}
                                onClick={() => retry.mutate(row.id)}
                              >
                                Retry
                              </Button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <p className="px-4 py-3 text-xs text-base-content/60">
                  Showing {logs.data.data.length} of {logs.data.total} records.
                </p>
              </div>
            ) : (
              <EmptyState
                title="No email records found"
                description="Try another status or recipient filter."
              />
            )}
            {retry.isError && (
              <p role="alert" className="text-sm text-error">
                {retry.error.message}
              </p>
            )}
            {retry.isSuccess && (
              <p role="status" className="text-sm text-success">
                Retry queued.
              </p>
            )}
          </div>
        </Card>
      ) : (
        <Card>
          {suppressions.isLoading ? (
            <div className="grid min-h-40 place-items-center">
              <Spinner label="Loading suppressions" />
            </div>
          ) : suppressions.isError ? (
            <ErrorState
              title="Suppressions could not be loaded"
              description={suppressions.error.message}
              onRetry={() => void suppressions.refetch()}
            />
          ) : suppressions.data?.length ? (
            <ul className="divide-y divide-base-content/10">
              {suppressions.data.map((entry) => (
                <li
                  className="flex flex-col gap-3 py-4 first:pt-0 sm:flex-row sm:items-center sm:justify-between"
                  key={entry.email}
                >
                  <div className="min-w-0">
                    <p className="break-all font-medium">{entry.email}</p>
                    <p className="mt-1 text-xs text-base-content/60">
                      {readable(entry.reason)} · {timestamp(entry.createdAt)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={clear.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Clear suppression for ${entry.email}? Future queued messages may be sent.`,
                        )
                      ) {
                        clear.mutate(entry.email)
                      }
                    }}
                  >
                    Clear suppression
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No suppressed addresses"
              description="Hard bounces and manually suppressed addresses will appear here."
            />
          )}
          {clear.isError && (
            <p role="alert" className="mt-3 text-sm text-error">
              {clear.error.message}
            </p>
          )}
          {clear.isSuccess && (
            <p role="status" className="mt-3 text-sm text-success">
              Suppression cleared.
            </p>
          )}
        </Card>
      )}
    </div>
  )
}
