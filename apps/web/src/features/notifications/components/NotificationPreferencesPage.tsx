import { useState } from 'react'

import { PageHeader } from '../../../components/common/PageHeader'
import { Button } from '../../../components/ui/Button'
import { Card } from '../../../components/ui/Card'
import { EmptyState } from '../../../components/ui/EmptyState'
import { ErrorState } from '../../../components/ui/ErrorState'
import { Spinner } from '../../../components/ui/Spinner'
import { notificationPreferencesApi } from '../api/client'
import { useNotificationPreferences, useUpdateNotificationPreferences } from '../api/hooks'

export function NotificationPreferencesPage() {
  const query = useNotificationPreferences()
  const update = useUpdateNotificationPreferences()
  const [draft, setDraft] = useState<Record<string, boolean> | null>(null)
  const preferences =
    query.data?.preferences.map((preference) => ({
      ...preference,
      emailEnabled: draft?.[preference.type] ?? preference.emailEnabled,
    })) ?? []

  const changed =
    query.data?.preferences.some((saved) => {
      const current = preferences.find((preference) => preference.type === saved.type)
      return current?.emailEnabled !== saved.emailEnabled
    }) ?? false

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Account"
        title="Notification preferences"
        description="Choose which operational email updates you receive. Account and security messages are always sent."
      />
      {query.isLoading ? (
        <div className="grid min-h-40 place-items-center">
          <Spinner label="Loading notification preferences" />
        </div>
      ) : query.isError ? (
        <ErrorState
          title="Preferences could not be loaded"
          description={query.error.message}
          onRetry={() => void query.refetch()}
        />
      ) : query.data ? (
        <div className="space-y-4">
          <Card>
            <div className="divide-y divide-base-content/10">
              {preferences.map((preference) => (
                <label
                  className="flex cursor-pointer items-start justify-between gap-4 py-4 first:pt-0 last:pb-0"
                  key={preference.type}
                >
                  <span className="space-y-1">
                    <span className="block font-medium">
                      {notificationPreferencesApi.label(preference.type)}
                    </span>
                    <span className="block text-sm text-base-content/60">
                      {notificationPreferencesApi.description(preference.type)}
                    </span>
                  </span>
                  <input
                    className="toggle toggle-primary mt-1 shrink-0"
                    type="checkbox"
                    checked={preference.emailEnabled}
                    onChange={(event) => {
                      setDraft((current) => ({
                        ...current,
                        [preference.type]: event.target.checked,
                      }))
                    }}
                    aria-label={`Enable ${notificationPreferencesApi.label(preference.type)}`}
                  />
                </label>
              ))}
              {query.data.mandatory.emailEnabled && (
                <div className="flex items-start justify-between gap-4 py-4 last:pb-0">
                  <span className="space-y-1">
                    <span className="block font-medium">Account and security messages</span>
                    <span className="block text-sm text-base-content/60">
                      Password resets, verification, and important account security notices.
                    </span>
                  </span>
                  <span className="badge badge-outline mt-1 shrink-0">Always on</span>
                </div>
              )}
              {!preferences.length && (
                <EmptyState
                  title="No optional email preferences"
                  description="There are no optional email categories for your account role yet."
                />
              )}
            </div>
          </Card>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              loading={update.isPending}
              disabled={!changed}
              onClick={() =>
                update.mutate(preferences, {
                  onSuccess: () => setDraft(null),
                })
              }
            >
              Save preferences
            </Button>
            {update.isSuccess && (
              <p role="status" className="text-sm text-success">
                Preferences saved.
              </p>
            )}
            {update.isError && (
              <p role="alert" className="text-sm text-error">
                {update.error.message}
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
