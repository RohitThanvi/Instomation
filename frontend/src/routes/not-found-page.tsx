import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { ROUTES } from '@/config/constants'

export function NotFoundPage() {
  return (
    <div className="grid min-h-[60dvh] place-items-center px-4 text-center">
      <div className="space-y-4">
        <p className="text-accent-600 text-sm font-medium">404</p>
        <h1 className="font-display text-3xl font-medium tracking-tight">
          We could not find that page
        </h1>
        <p className="text-ink-muted">The link may be out of date, or the page may have moved.</p>
        <Button asChild>
          <Link to={ROUTES.home}>Back to overview</Link>
        </Button>
      </div>
    </div>
  )
}
