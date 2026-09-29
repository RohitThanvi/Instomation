import { UserButton } from '@clerk/clerk-react'
import { LayoutDashboard, Plug, Rocket } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { Brand } from './brand'
import { OrganizationSwitcher } from './organization-switcher'
import { ROUTES } from '@/config/constants'
import { cn } from '@/lib/cn'

const NAV_ITEMS = [
  { to: ROUTES.home, label: 'Overview', icon: LayoutDashboard },
  { to: ROUTES.instagramSettings, label: 'Instagram', icon: Plug },
  { to: `${ROUTES.onboarding}/welcome`, label: 'Setup guide', icon: Rocket },
] as const

export function AppLayout() {
  return (
    <div className="bg-canvas flex min-h-dvh">
      <aside className="border-line bg-surface hidden w-60 shrink-0 flex-col gap-8 border-r px-4 py-6 md:flex">
        <Brand />
        <nav aria-label="Primary" className="flex flex-col gap-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-accent-50 text-accent-700'
                    : 'text-ink-muted hover:bg-sunken hover:text-ink',
                )
              }
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-line bg-surface/80 flex h-16 items-center justify-between gap-4 border-b px-4 backdrop-blur md:px-8">
          <div className="md:hidden">
            <Brand />
          </div>
          <div className="ml-auto flex items-center gap-4">
            <OrganizationSwitcher />
            <UserButton />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
