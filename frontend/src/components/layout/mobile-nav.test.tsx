import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppLayout } from './app-layout'
import { organization } from '@/test/fixtures'
import { installMockApi } from '@/test/mock-api'
import { renderWithSession } from '@/test/render-app'

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ isSignedIn: true, getToken: () => Promise.resolve('tok') }),
  UserButton: () => null,
}))

type Role = 'owner' | 'admin' | 'manager' | 'staff'

function mount(role: Role = 'owner') {
  installMockApi({
    'GET /api/v1/organizations': () => ({
      body: { items: [organization({ role })], next_cursor: null },
    }),
  })
  // A wildcard route keeps the layout mounted as the location changes.
  return renderWithSession(<AppLayout />, { path: '/', route: '/*' })
}

const openMenu = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Open menu' }))
  return screen.getByRole('dialog', { name: 'Menu' })
}
const linkNames = (container: HTMLElement) =>
  within(container)
    .getAllByRole('link')
    .map((link) => link.textContent)

describe('mobile navigation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.className = ''
  })

  it('is closed until asked for, and says so to assistive technology', async () => {
    mount()
    const button = await screen.findByRole('button', { name: 'Open menu' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await userEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
  })

  it('opens a modal dialog and moves focus into it', async () => {
    mount()
    const dialog = await openMenu()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveFocus()
    expect(within(dialog).getByRole('navigation', { name: 'Menu' })).toBeInTheDocument()
  })

  it.each(['owner', 'admin', 'manager', 'staff'] as const)(
    'offers a %s exactly the pages the sidebar does',
    async (role) => {
      mount(role)
      const dialog = await openMenu()
      const sidebar = screen.getByRole('navigation', { name: 'Primary' })
      expect(linkNames(dialog)).toEqual(linkNames(sidebar))
    },
  )

  it('hides the knowledge base from roles that cannot open it, in the menu too', async () => {
    mount('staff')
    const dialog = await openMenu()
    expect(within(dialog).getByRole('link', { name: 'Inbox' })).toBeInTheDocument()
    expect(within(dialog).queryByRole('link', { name: 'Knowledge' })).not.toBeInTheDocument()
  })

  it('keeps settings from staff and shows it to an owner', async () => {
    mount('staff')
    expect(
      within(await openMenu()).queryByRole('link', { name: 'Settings' }),
    ).not.toBeInTheDocument()
  })

  it('shows settings to an owner in the menu', async () => {
    mount('owner')
    expect(within(await openMenu()).getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/settings',
    )
  })

  it('shows the knowledge base to an owner', async () => {
    mount('owner')
    const dialog = await openMenu()
    expect(within(dialog).getByRole('link', { name: 'Knowledge' })).toHaveAttribute(
      'href',
      '/knowledge',
    )
  })

  describe('closing', () => {
    it('closes on Escape and returns focus to the menu button', async () => {
      mount()
      await openMenu()
      await userEvent.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Open menu' })).toHaveFocus()
    })

    it('closes with the close button and returns focus', async () => {
      mount()
      await openMenu()
      await userEvent.click(screen.getByRole('button', { name: 'Close menu' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Open menu' })).toHaveFocus()
    })

    it('closes when the dimmed page behind it is tapped', async () => {
      mount()
      const dialog = await openMenu()
      await userEvent.click(dialog.previousElementSibling as HTMLElement)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('closes after choosing a page, which becomes the current one', async () => {
      mount()
      const dialog = await openMenu()
      await userEvent.click(within(dialog).getByRole('link', { name: 'Inbox' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      const sidebar = screen.getByRole('navigation', { name: 'Primary' })
      expect(within(sidebar).getByRole('link', { name: 'Inbox' })).toHaveAttribute(
        'aria-current',
        'page',
      )
    })

    it('still closes when the chosen page is the one already open', async () => {
      mount()
      const dialog = await openMenu()
      // The path does not change, so only the link's own handler can close the menu.
      await userEvent.click(within(dialog).getByRole('link', { name: 'Overview' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('closes when the page changes some other way, and opens again afterwards', async () => {
      mount()
      await openMenu()
      // e.g. the browser's back button; here, a link elsewhere on the page.
      const sidebar = screen.getByRole('navigation', { name: 'Primary' })
      await userEvent.click(within(sidebar).getByRole('link', { name: 'Instagram' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(await openMenu()).toBeInTheDocument()
    })
  })

  describe('keyboard', () => {
    it('keeps Tab inside the open menu, wrapping both ways', async () => {
      mount()
      const dialog = await openMenu()
      const links = within(dialog).getAllByRole('link')
      const closeButton = screen.getByRole('button', { name: 'Close menu' })

      links.at(-1)?.focus()
      await userEvent.tab()
      expect(closeButton).toHaveFocus()

      await userEvent.tab({ shift: true })
      expect(links.at(-1)).toHaveFocus()
    })
  })

  describe('page scrolling', () => {
    it('is locked while the menu is open and released when it closes', async () => {
      mount()
      expect(document.body).not.toHaveClass('overflow-hidden')
      await openMenu()
      expect(document.body).toHaveClass('overflow-hidden')
      await userEvent.keyboard('{Escape}')
      expect(document.body).not.toHaveClass('overflow-hidden')
    })

    it('is released if the layout goes away while the menu is open', async () => {
      const { unmount } = mount()
      await openMenu()
      unmount()
      expect(document.body).not.toHaveClass('overflow-hidden')
    })
  })
})
