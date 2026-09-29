# Frontend

Vite SPA in `frontend/`: React 19, TypeScript (strict), React Router, Tailwind 4, Radix-based
shadcn-style primitives, TanStack Query, React Hook Form, Zod, Recharts, Lucide, Clerk. No Next.js.

## Run and test

```bash
cd frontend
cp .env.example .env.local     # set VITE_CLERK_PUBLISHABLE_KEY
npm ci
npm run dev                    # http://localhost:5173
npm run typecheck && npm run lint && npm run format:check && npm test
npm run build
```

Full stack: `docker compose up -d --build` (the `frontend` service serves the static build on :5173).
`VITE_*` values are inlined **at build time** and are public; rebuild the image to change them. Backend
`CORS_ALLOWED_ORIGINS` and `CLERK_AUTHORIZED_PARTIES` must include the frontend origin.

## Structure

```
src/config/      env parsing (Zod) and constants; nothing else reads import.meta.env
src/api/         ApiClient, ApiError + envelope parsing, Zod schemas, one module per endpoint group
src/auth/        Clerk-backed SessionProvider (API client, organizations, tenant selection), route guard
src/components/  ui/ (primitives), layout/ (shell)
src/routes/      route components (lazy-loaded), providers, router
```

## Conventions

- **One HTTP path.** All calls go through `ApiClient.request`, which sends the Clerk token as
  `Authorization: Bearer`, an `X-Request-ID`, validates the response with the given Zod schema, and turns any
  failure into an `ApiError` (`{error:{code,message}}` envelope, or a client-side code). UI shows `error.message`;
  unknown failures show a generic message and never raw error text.
- **Tenancy.** The browser never sends `organization_id` in a body or query. `X-Organization-ID` is a *selection*
  the server validates against membership; it is sent only when the user belongs to more than one organization.
- **Capabilities.** Controls for comment likes and profile updates render only if
  `GET /instagram/capabilities` reports them enabled. The server currently always reports them disabled.
- **Not yet available.** Endpoints that do not exist yet (`conversations`, `messages`, `comments`, `automations`,
  `business`, `knowledge`, `analytics`, `settings`, `usage`) are typed in `src/api/` when their screen is built and
  render an explicit "not yet available" state. No fabricated data, no fake success.
- **Retries.** Only network failures and `AUTH_PROVIDER_UNAVAILABLE` are retried (bounded).
- **Design.** All colors, radii, shadows, fonts and motion are tokens in `src/index.css` (`@theme`).
- **No dead code.** A primitive is added together with the first screen that uses it.

## Status

| Screen | State |
|---|---|
| 1. Auth shell (Clerk sign-in/up, guard, layout, error boundary, toasts) | Done |
| 2. Onboarding (9 steps) | Next |
| 3. Dashboard | Planned |
| 4. Inbox | Planned |
| 5. Automation rules | Planned |
| 6. Knowledge base | Planned |
| 7. Settings / usage / admin | Planned |
| 8. Role-aware UI (permission helper, applied per screen) | Planned |

## Known follow-ups

- Switching organizations must reset tenant-scoped queries. Add a `['tenant', orgId, ...]` key factory with the
  first tenant-scoped endpoint.
- The initial bundle is dominated by Clerk (~570 kB min, ~170 kB gzip). Revisit chunking once more screens land.
- No CSP header yet: Clerk's frontend API host is instance-specific and needs to be templated into nginx.
