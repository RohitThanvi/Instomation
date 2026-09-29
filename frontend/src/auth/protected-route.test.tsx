import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ProtectedRoute } from './protected-route'

const useAuth = vi.fn()
vi.mock('@clerk/clerk-react', () => ({ useAuth: () => useAuth() as unknown }))

function Location() {
  const { pathname, search } = useLocation()
  return <p>{`${pathname}${search}`}</p>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sign-in" element={<Location />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/inbox" element={<p>Inbox</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('ProtectedRoute', () => {
  it('shows a loading state until Clerk has loaded', () => {
    useAuth.mockReturnValue({ isLoaded: false, isSignedIn: undefined })
    renderAt('/inbox')
    expect(screen.getByRole('status', { name: /loading your session/i })).toBeInTheDocument()
  })

  it('redirects signed-out visitors to sign-in, remembering where they were going', () => {
    useAuth.mockReturnValue({ isLoaded: true, isSignedIn: false })
    renderAt('/inbox?tab=new')
    expect(screen.getByText('/sign-in?redirect_url=%2Finbox%3Ftab%3Dnew')).toBeInTheDocument()
  })

  it('renders the protected content for signed-in users', () => {
    useAuth.mockReturnValue({ isLoaded: true, isSignedIn: true })
    renderAt('/inbox')
    expect(screen.getByText('Inbox')).toBeInTheDocument()
  })
})
