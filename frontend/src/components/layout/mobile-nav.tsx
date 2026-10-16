import { Menu, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Brand } from './brand'
import { NavLinks } from './nav-links'
import type { NavItem } from './nav-items'
import { Button } from '@/components/ui/button'

const FOCUSABLE = 'a[href], button:not([disabled])'

/**
 * The sidebar is hidden below the `md` breakpoint, so this is how navigation works on a phone:
 * a menu button in the header that opens the same links in a modal drawer.
 */
export function MobileNav({ items }: { items: readonly NavItem[] }) {
  const { pathname } = useLocation()
  // Opened "at" a path, so moving to another page closes it without an effect.
  const [openedAt, setOpenedAt] = useState<string | null>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const open = openedAt === pathname

  function close() {
    setOpenedAt(null)
    menuButton.current?.focus()
  }

  return (
    <div className="md:hidden">
      <Button
        ref={menuButton}
        variant="ghost"
        size="sm"
        aria-label="Open menu"
        aria-expanded={open}
        aria-controls="mobile-nav"
        onClick={() => {
          setOpenedAt(pathname)
        }}
      >
        <Menu className="size-5" aria-hidden />
      </Button>
      {open && <Drawer items={items} onClose={close} />}
    </div>
  )
}

function Drawer({ items, onClose }: { items: readonly NavItem[]; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeButton.current?.focus()
    // The page behind must not scroll while the menu is open.
    document.body.classList.add('overflow-hidden')
    return () => {
      document.body.classList.remove('overflow-hidden')
    }
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      // Keep keyboard focus inside the open menu.
      const focusable = panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (first === undefined || last === undefined) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return (
    <div id="mobile-nav" className="fixed inset-0 z-40">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        className="bg-ink/40 absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className="border-line bg-surface absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-8 border-r px-4 py-6 shadow-lg"
      >
        <div className="flex items-center justify-between">
          <Brand />
          <Button
            ref={closeButton}
            variant="ghost"
            size="sm"
            aria-label="Close menu"
            onClick={onClose}
          >
            <X className="size-5" aria-hidden />
          </Button>
        </div>
        <NavLinks items={items} label="Menu" onNavigate={onClose} />
      </div>
    </div>
  )
}
