import {
  BookOpen,
  HandHelping,
  LayoutDashboard,
  MessageSquare,
  Plug,
  Rocket,
  Settings,
  Gauge,
} from 'lucide-react'
import { can, type Permission } from '@/auth/permissions'
import { useSession } from '@/auth/session-context'
import { ROUTES } from '@/config/constants'

export interface NavItem {
  to: string
  label: string
  icon: typeof LayoutDashboard
  /** Hidden from roles without it; the server still enforces access. */
  requires?: Permission
}

const NAV_ITEMS: readonly NavItem[] = [
  { to: ROUTES.home, label: 'Overview', icon: LayoutDashboard },
  { to: ROUTES.inbox, label: 'Inbox', icon: MessageSquare },
  { to: ROUTES.handoffs, label: 'Handoffs', icon: HandHelping },
  { to: ROUTES.knowledge, label: 'Knowledge', icon: BookOpen, requires: 'settings_manage' },
  { to: ROUTES.usage, label: 'Usage', icon: Gauge, requires: 'settings_manage' },
  { to: ROUTES.settings, label: 'Settings', icon: Settings, requires: 'settings_manage' },
  { to: ROUTES.instagramSettings, label: 'Instagram', icon: Plug },
  { to: `${ROUTES.onboarding}/welcome`, label: 'Setup guide', icon: Rocket },
]

/** The pages the current member may open. One list feeds both the sidebar and the mobile menu. */
export function useVisibleNavItems(): readonly NavItem[] {
  const { currentOrganization } = useSession()
  return NAV_ITEMS.filter(
    ({ requires }) =>
      requires === undefined ||
      (currentOrganization !== null && can(currentOrganization.role, requires)),
  )
}
