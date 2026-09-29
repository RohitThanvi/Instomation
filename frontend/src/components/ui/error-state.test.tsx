import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ErrorState } from './error-state'
import { ApiError } from '@/api/errors'

describe('ErrorState', () => {
  it('shows the server message for API errors and offers a retry', async () => {
    const onRetry = vi.fn()
    render(
      <ErrorState
        error={
          new ApiError(503, 'AUTH_PROVIDER_UNAVAILABLE', 'Sign-in is temporarily unavailable.')
        }
        onRetry={onRetry}
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Sign-in is temporarily unavailable.')
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('never leaks raw error text for unknown failures', () => {
    render(<ErrorState error={new Error('TypeError: secret internals')} />)
    expect(screen.getByRole('alert')).not.toHaveTextContent('secret internals')
    expect(screen.getByRole('alert')).toHaveTextContent(/something went wrong/i)
  })
})
