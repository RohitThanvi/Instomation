import { NavLink } from 'react-router-dom'
import type { NavItem } from './nav-items'
import { ROUTES } from '@/config/constants'
import { cn } from '@/lib/cn'

interface NavLinksProps {
  items: readonly NavItem[]
  /** Distinguishes the sidebar from the mobile menu for assistive technology. */
  label: string
  onNavigate?: () => void
}

export function NavLinks({ items, label, onNavigate }: NavLinksProps) {
  return (
    <nav aria-label={label} className="flex flex-col gap-1">
      {items.map(({ to, label: text, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === ROUTES.home}
          onClick={onNavigate}
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
          {text}
        </NavLink>
      ))}
    </nav>
  )
}
