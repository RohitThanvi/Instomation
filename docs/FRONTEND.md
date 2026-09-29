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
src/features/    onboarding/ (9-step flow, drafts), instagram/ (accounts, capabilities, OAuth result)
src/test/        fake-fetch API (`mock-api`), fixtures captured from the real backend, render helper
src/routes/      route components (lazy-loaded), providers, router
```

## Conventions

- **One HTTP path.** All calls go through `ApiClient.request`, which sends the Clerk token as
  `Authorization: Bearer`, an `X-Request-ID`, validates the response with the given Zod schema, and turns any
  failure into an `ApiError` (`{error:{code,message}}` envelope, or a client-side code). UI shows `error.message`;
  unknown failures show a generic message and never raw error text.
- **Tenancy.** The browser never sends `organization_id` in a body or query. `X-Organization-ID` is a _selection_
  the server validates against membership; it is sent only when the user belongs to more than one organization.
- **Capabilities.** Controls for comment likes and profile updates render only if
  `GET /instagram/capabilities` reports them enabled. The server currently always reports them disabled.
- **Enum casing.** The backend sends lowercase enum values (`role: "owner"`, `status: "active"`, `account_type`).
  Zod schemas mirror the wire exactly; test fixtures are copied from real responses, never invented.
- **Capabilities.** Feature ids are `FEATURE_*` strings. A feature is offered only if it is in the UI's known set
  _and_ the server reports it enabled, so comment-like and profile updates can never render, even if a server
  claimed otherwise. Controls for a reply action the server disabled are hidden, and its stored value is forced off.
- **Instagram state.** An account is "live" only when `status=active` _and_ `webhook_subscribed=true`. Expired tokens
  read "Reconnect required"; an unsubscribed webhook reads "Not receiving messages yet".
- **OAuth return.** Meta returns to `/settings/instagram?status=connected|error&reason=CODE`. Every documented reason
  has its own message; unknown or malformed reasons get a generic one and query text is never echoed.
- **Tenant keys.** Tenant data is cached under `tenantKey(orgId, ...)`, so switching workspaces cannot show stale rows.
- **Not yet available.** Endpoints that do not exist yet (`business`, `settings`, and later `conversations`,
  `messages`, `comments`, `automations`, `knowledge`, `analytics`, `usage`) are typed in `src/api/` and reject with
  `NotYetAvailableError` without touching the network; the screen renders `<NotYetAvailable>`. No fabricated data,
  no fake success. Onboarding answers for steps 4-7 stay in this browser (per workspace) until
  `saveBusinessSetup` can call a real endpoint.
- **Retries.** Only network failures and `AUTH_PROVIDER_UNAVAILABLE` are retried (bounded).
- **Design.** All colors, radii, shadows, fonts and motion are tokens in `src/index.css` (`@theme`).
- **No dead code.** A primitive is added together with the first screen that uses it.

## Status

| Screen                                                                  | State                                                                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1. Auth shell (Clerk sign-in/up, guard, layout, error boundary, toasts) | Done                                                                                  |
| 2. Onboarding (9 steps) + Instagram connection and OAuth return page    | Done. Steps 4-7 and activation are local-only: the backend endpoints do not exist yet |
| 3. Dashboard                                                            | Next                                                                                  |
| 4. Inbox                                                                | Planned                                                                               |
| 5. Automation rules                                                     | Planned                                                                               |
| 6. Knowledge base                                                       | Planned                                                                               |
| 7. Settings / usage / admin                                             | Planned                                                                               |
| 8. Role-aware UI (permission helper, applied per screen)                | Planned                                                                               |

## Known follow-ups

- When `/api/v1/business` and `/api/v1/settings` ship, implement `saveBusinessSetup` and remove the local-only
  notice from onboarding steps 4-7.
- Onboarding has no server-side "completed" flag, so a user with a workspace is not forced back into it; the sidebar
  keeps a "Setup guide" link.
- The initial bundle is dominated by Clerk (~570 kB min, ~170 kB gzip). Revisit chunking once more screens land.
- No CSP header yet: Clerk's frontend API host is instance-specific and needs to be templated into nginx.
