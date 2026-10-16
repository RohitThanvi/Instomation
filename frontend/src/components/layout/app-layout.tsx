import { UserButton } from '@clerk/clerk-react'
import { Outlet } from 'react-router-dom'
import { Brand } from './brand'
import { MobileNav } from './mobile-nav'
import { NavLinks } from './nav-links'
import { useVisibleNavItems } from './nav-items'
import { OrganizationSwitcher } from './organization-switcher'

export function AppLayout() {
  const items = useVisibleNavItems()
  return (
    <div className="bg-canvas flex min-h-dvh">
      <aside className="border-line bg-surface hidden w-60 shrink-0 flex-col gap-8 border-r px-4 py-6 md:flex">
        <Brand />
        <NavLinks items={items} label="Primary" />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-line bg-surface/80 flex h-16 items-center justify-between gap-4 border-b px-4 backdrop-blur md:px-8">
          <div className="flex items-center gap-2 md:hidden">
            <MobileNav items={items} />
            <Brand />
          </div>
          <div className="ml-auto flex items-center gap-4">
            <OrganizationSwitcher />
            <UserButton />
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 md:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
