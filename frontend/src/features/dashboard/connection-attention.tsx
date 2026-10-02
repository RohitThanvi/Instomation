import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { ROUTES } from '@/config/constants'
import { useInstagramAccounts } from '@/features/instagram/use-instagram'
import { summarizeConnectionHealth } from './connection-health'

/** Renders nothing unless something about the connection needs the user's attention. */
export function ConnectionAttention() {
  const accounts = useInstagramAccounts()
  if (!accounts.isSuccess) return null
  const health = summarizeConnectionHealth(accounts.data)
  if (health === null) return null

  return (
    <Notice
      tone={health.tone}
      title={health.title}
      actions={
        <Button asChild variant="secondary" size="sm">
          <Link to={ROUTES.instagramSettings}>Review connection</Link>
        </Button>
      }
    >
      {health.detail}
    </Notice>
  )
}
