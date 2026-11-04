import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Brand } from '@/components/layout/brand'
import { LEGAL_EFFECTIVE_DATE, ROUTES } from '@/config/constants'
import type { LegalIdentity } from '@/config/env'

const LEGAL_LINKS = [
  { to: ROUTES.privacy, label: 'Privacy policy' },
  { to: ROUTES.terms, label: 'Terms of service' },
  { to: ROUTES.dataDeletion, label: 'Data deletion' },
] as const

export function LegalLayout({
  title,
  legal,
  children,
}: {
  title: string
  legal: LegalIdentity
  children: ReactNode
}) {
  return (
    <div className="bg-canvas min-h-dvh">
      <header className="border-line border-b px-4 py-4">
        <Link to={ROUTES.home} aria-label="Instomation home">
          <Brand />
        </Link>
      </header>
      <main className="mx-auto max-w-3xl space-y-8 px-4 py-10">
        <div className="space-y-2">
          <h1 className="font-display text-ink text-3xl font-medium tracking-tight">{title}</h1>
          <p className="text-ink-muted text-sm">Effective {LEGAL_EFFECTIVE_DATE}</p>
        </div>
        {children}
      </main>
      <footer className="border-line text-ink-muted mx-auto max-w-3xl space-y-3 border-t px-4 py-8 text-sm">
        <nav aria-label="Legal" className="flex flex-wrap gap-x-6 gap-y-2">
          {LEGAL_LINKS.map((link) => (
            <Link key={link.to} to={link.to} className="hover:text-ink underline">
              {link.label}
            </Link>
          ))}
        </nav>
        <p>
          Instomation is operated by {legal.entityName}. Questions:{' '}
          <a href={`mailto:${legal.contactEmail}`} className="hover:text-ink underline">
            {legal.contactEmail}
          </a>
        </p>
      </footer>
    </div>
  )
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-ink text-xl font-medium">{title}</h2>
      <div className="text-ink-muted space-y-3 leading-relaxed [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">
        {children}
      </div>
    </section>
  )
}

export function ContactLink({ legal }: { legal: LegalIdentity }) {
  return (
    <a href={`mailto:${legal.contactEmail}`} className="text-accent-600 underline">
      {legal.contactEmail}
    </a>
  )
}
