import { render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import type { Env } from '@/config/env'
import { DELETION_DEADLINE_DAYS, LEGAL_EFFECTIVE_DATE, ROUTES } from '@/config/constants'
import { createRoutes } from '@/routes/router'

// Signed out on purpose: Meta's reviewers open these pages without an account.
vi.mock('@clerk/clerk-react', () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ isLoaded: true, isSignedIn: false, getToken: () => Promise.resolve(null) }),
}))

const env: Env = {
  apiBaseUrl: 'https://api.test',
  clerkPublishableKey: 'pk_test_x',
  legal: { entityName: 'Acme Labs Pvt Ltd', contactEmail: 'privacy@acme.test' },
}

function open(path: string) {
  const router = createMemoryRouter(createRoutes(env), { initialEntries: [path] })
  render(<RouterProvider router={router} />)
}

describe.each([
  [ROUTES.privacy, 'Privacy policy'],
  [ROUTES.terms, 'Terms of service'],
  [ROUTES.dataDeletion, 'Data deletion'],
])('%s', (path, title) => {
  it('is public and names the operator and a contact address', async () => {
    open(path)
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
    expect(screen.getByText(`Effective ${LEGAL_EFFECTIVE_DATE}`)).toBeInTheDocument()
    const footer = screen.getByRole('contentinfo')
    expect(within(footer).getByText(/operated by Acme Labs Pvt Ltd/)).toBeInTheDocument()
    expect(within(footer).getByRole('link', { name: 'privacy@acme.test' })).toHaveAttribute(
      'href',
      'mailto:privacy@acme.test',
    )
  })

  it('links to the other two legal pages', async () => {
    open(path)
    const nav = await screen.findByRole('navigation', { name: 'Legal' })
    expect(within(nav).getByRole('link', { name: 'Privacy policy' })).toHaveAttribute(
      'href',
      ROUTES.privacy,
    )
    expect(within(nav).getByRole('link', { name: 'Terms of service' })).toHaveAttribute(
      'href',
      ROUTES.terms,
    )
    expect(within(nav).getByRole('link', { name: 'Data deletion' })).toHaveAttribute(
      'href',
      ROUTES.dataDeletion,
    )
  })
})

describe('data deletion instructions', () => {
  it('tell people how to disconnect, whom to email and how long deletion takes', async () => {
    open(ROUTES.dataDeletion)
    expect(await screen.findByRole('link', { name: /settings/i })).toHaveAttribute(
      'href',
      ROUTES.instagramSettings,
    )
    const main = screen.getByRole('main')
    expect(within(main).getAllByRole('link', { name: 'privacy@acme.test' }).length).toBeGreaterThan(
      0,
    )
    expect(main).toHaveTextContent(`within ${DELETION_DEADLINE_DAYS} days`)
  })
})

describe('privacy policy', () => {
  it('states the same deletion deadline as the deletion page', async () => {
    open(ROUTES.privacy)
    expect(await screen.findByRole('main')).toHaveTextContent(
      `within ${DELETION_DEADLINE_DAYS} days`,
    )
  })

  it('names the AI providers that receive message text', async () => {
    open(ROUTES.privacy)
    expect(await screen.findByRole('main')).toHaveTextContent(/Groq.*OpenAI/s)
  })
})
