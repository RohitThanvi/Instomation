import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { ROUTES } from '@/config/constants'
import { describeAccount } from '@/features/instagram/account-status'
import { useInstagramAccounts } from '@/features/instagram/use-instagram'

export function ConnectionCard() {
  const accounts = useInstagramAccounts()

  if (accounts.isPending) return <Skeleton className="h-40 w-full" />
  if (accounts.isError) {
    return (
      <ErrorState
        error={accounts.error}
        title="We could not load your Instagram connection"
        onRetry={() => void accounts.refetch()}
      />
    )
  }

  const items = accounts.data
  return (
    <Card>
      <CardHeader>
        <CardTitle>Instagram connection</CardTitle>
        <CardDescription>
          {items.length === 0
            ? 'No Instagram account is connected yet.'
            : 'The accounts Instomation works with.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {items.length > 0 && (
          <ul className="divide-line divide-y">
            {items.map((account) => {
              const status = describeAccount(account)
              return (
                <li key={account.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-ink truncate text-sm font-medium">@{account.username}</p>
                    <p className="text-ink-muted text-sm">{status.detail}</p>
                  </div>
                  <Badge tone={status.tone} className="shrink-0">
                    {status.label}
                  </Badge>
                </li>
              )
            })}
          </ul>
        )}
        <Button asChild variant={items.length === 0 ? 'primary' : 'secondary'} size="sm">
          <Link to={ROUTES.instagramSettings}>
            {items.length === 0 ? 'Connect Instagram' : 'Manage connection'}
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}
