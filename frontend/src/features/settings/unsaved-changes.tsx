import { useEffect, useRef } from 'react'
import { useBlocker } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'

/**
 * Stops a person from losing edits by accident: leaving the page in the app asks first, and closing or
 * reloading the tab uses the browser's own warning.
 */
export function UnsavedChangesGuard({ dirty }: { dirty: boolean }) {
  const blocker = useBlocker(dirty)

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => {
      window.removeEventListener('beforeunload', warn)
    }
  }, [dirty])

  const stay = useRef<HTMLButtonElement>(null)
  const blocked = blocker.state === 'blocked'
  useEffect(() => {
    // The prompt appears without the person asking for it, so bring it into focus.
    if (blocked) stay.current?.focus()
  }, [blocked])

  if (blocker.state !== 'blocked') return null
  return (
    <Notice
      tone="warning"
      title="You have changes that are not saved"
      actions={
        <>
          <Button
            ref={stay}
            size="sm"
            onClick={() => {
              blocker.reset()
            }}
          >
            Keep editing
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              blocker.proceed()
            }}
          >
            Leave without saving
          </Button>
        </>
      }
    >
      If you leave this page now, what you changed will be lost.
    </Notice>
  )
}
