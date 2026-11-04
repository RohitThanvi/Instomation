import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_PREFIX, ROUTES } from './constants'

// Caddy serves /robots.txt and /sitemap.xml (deploy/Caddyfile). They list paths by hand, so this
// keeps them in step with the routes the app really has.
const caddyfile = readFileSync(resolve(process.cwd(), '../deploy/Caddyfile'), 'utf8')
const disallowed = [...caddyfile.matchAll(/^Disallow: (\S+)$/gm)].map((match) => match[1] ?? '')
const sitemapPaths = [...caddyfile.matchAll(/<loc>\{scheme\}:\/\/\{host\}(\S+?)<\/loc>/g)].map(
  (match) => match[1] ?? '',
)

const PUBLIC_PAGES: string[] = [ROUTES.privacy, ROUTES.terms, ROUTES.dataDeletion]
const AUTH_PAGES: string[] = [ROUTES.home, ROUTES.signIn, ROUTES.signUp]
const APP_PAGES = Object.values(ROUTES).filter(
  (path) => !PUBLIC_PAGES.includes(path) && !AUTH_PAGES.includes(path),
)

const isDisallowed = (path: string) => disallowed.some((prefix) => path.startsWith(prefix))

describe('crawler files in deploy/Caddyfile', () => {
  it('keeps crawlers out of the API and every signed-in page', () => {
    expect(isDisallowed(`${API_PREFIX}/anything`)).toBe(true)
    expect(APP_PAGES.length).toBeGreaterThan(0)
    for (const path of APP_PAGES) expect(isDisallowed(path), path).toBe(true)
  })

  it('lists exactly the public legal pages in the sitemap and does not block them', () => {
    expect([...sitemapPaths].sort()).toEqual([...PUBLIC_PAGES].sort())
    for (const path of PUBLIC_PAGES) expect(isDisallowed(path), path).toBe(false)
  })

  it('does not block the sign-in pages that visitors land on', () => {
    for (const path of [ROUTES.signIn, ROUTES.signUp]) expect(isDisallowed(path), path).toBe(false)
  })
})
