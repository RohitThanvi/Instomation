import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { STORAGE_KEYS } from '@/config/constants'
import { InstagramConnection } from '@/features/instagram/instagram-connection'
import { parseOAuthResult } from '@/features/instagram/oauth-result'
import { stepPath } from '@/features/onboarding/steps'
import { readStorage, removeStorage } from '@/lib/storage'

/** Also the browser landing page after Instagram's consent screen (`?status=connected|error&reason=`). */
export function InstagramSettingsPage() {
  const [params] = useSearchParams()
  const result = parseOAuthResult(params)
  // Read once, then clear: the flag only exists to resume setup after the round trip to Instagram.
  const [resumeSetup] = useState(() => readStorage(STORAGE_KEYS.onboardingReturn) === '1')
  useEffect(() => {
    removeStorage(STORAGE_KEYS.onboardingReturn)
  }, [])

  const setupAction =
    resumeSetup && result !== null ? (
      <Button asChild size="sm" variant={result.status === 'connected' ? 'primary' : 'secondary'}>
        <Link to={stepPath(result.status === 'connected' ? 'profile' : 'instagram')}>
          {result.status === 'connected' ? 'Continue setup' : 'Back to setup'}
        </Link>
      </Button>
    ) : undefined

  return (
    <div className="animate-fade-in space-y-8">
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-medium tracking-tight">Instagram</h1>
        <p className="text-ink-muted max-w-xl">
          Manage the Instagram accounts your assistant works with.
        </p>
      </div>
      {result?.status === 'connected' && (
        <Notice tone="success" title="Instagram connected" actions={setupAction}>
          Your account is linked. Check its status below to confirm messages are coming through.
        </Notice>
      )}
      {result?.status === 'error' && (
        <Notice tone="danger" title="We could not connect Instagram" actions={setupAction}>
          {result.message}
        </Notice>
      )}
      <InstagramConnection returnToOnboarding={resumeSetup} />
    </div>
  )
}
