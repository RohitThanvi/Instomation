import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppLayout } from './app-layout'
import { organization } from '@/test/fixtures'
import { installMockApi } from '@/test/mock-api'
import { renderWithSession } from '@/test/render-app'

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isSignedIn: true, getToken: () => Promise.resolve('tok') }),
  UserButton: () => null,
}))

function mount(role: 'owner' | 'admin' | 'manager' | 'staff') {
  installMockApi({
    'GET /api/v1/organizations': () => ({
      body: { items: [organization({ role })], next_cursor: null },
    }),
  })
  renderWithSession(<AppLayout />, { path: '/', route: '/' })
}

describe('AppLayout navigation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(['owner', 'admin'] as const)('offers the knowledge base to an %s', async (role) => {
    mount(role)
    expect(await screen.findByRole('link', { name: 'Knowledge' })).toHaveAttribute(
      'href',
      '/knowledge',
    )
  })

  it.each(['manager', 'staff'] as const)(
    'does not offer the knowledge base to a %s',
    async (role) => {
      mount(role)
      expect(await screen.findByRole('link', { name: 'Inbox' })).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: 'Knowledge' })).not.toBeInTheDocument()
    },
  )

  it('links the handoff queue to its page', async () => {
    mount('staff')
    expect(await screen.findByRole('link', { name: 'Handoffs' })).toHaveAttribute(
      'href',
      '/handoffs',
    )
  })

  it('always offers the pages every role can use', async () => {
    mount('staff')
    for (const name of ['Overview', 'Inbox', 'Handoffs', 'Instagram']) {
      expect(await screen.findByRole('link', { name })).toBeInTheDocument()
    }
  })
})
