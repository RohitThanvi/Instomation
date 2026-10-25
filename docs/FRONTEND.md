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
src/features/    onboarding/ (9-step flow, drafts), instagram/ (accounts, capabilities, OAuth result),
                 inbox/ (list, thread, composer, customer context, filters),
                 handoffs/ (queue of conversations that need a person, waiting and resolved views),
                 settings/ (assistant behaviour and business profile; owners and admins),
                 usage/ (AI requests and estimated cost by day, purpose and model; owners and admins),
                 dashboard/ (connection health, supported actions, analytics view)
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
- **Dashboard.** The Instagram cards and the "reconnect" banner use live data and work for every role. Analytics call
  the live `GET /api/v1/analytics/overview` (`src/api/analytics.ts`, validated against the real response shape) for the
  last 7, 30 (default) or 90 UTC days, and are gated by `analytics_view` (staff see an explanatory notice and no
  request is made). The conversation-state card is the current state, not the period; the chart's outgoing line counts
  every outbound message including failed deliveries, and the totals card "Replies sent by AI" counts only sent ones.
  Charts always ship with a text alternative: a labelled `role="img"` plus a data table.
- **Inbox.** Backed by the live conversations API (`src/api/conversations.ts`, hooks in `features/inbox/use-inbox.ts`).
  The UI shows what the server returns and does no optimistic updates: every action returns the updated conversation,
  which replaces the cached copy, and lists are then refetched. Rules it enforces, mirroring the backend:
  - A person can reply only while the conversation is `human_required` or `human_active` (the server answers 409
    `CONVERSATION_NOT_HUMAN_CONTROLLED` otherwise). The composer also closes when `FEATURE_DM_REPLY` is off. If a reply
    is rejected, the draft is kept and the conversation is re-synced.
  - Internal notes go to `/notes`, are rendered as team-only cards, and never carry a delivery status.
  - Delivery is shown truthfully: `pending` (and polls faster), `failed` and `suppressed` each have a caption.
  - A message's `channel` is captioned unless it is a plain direct message (`channelCaption`): "Public comment",
    "Public reply" and "Private reply to a comment", so the up-to-three messages one comment produces are distinguishable.
  - AI confidence is shown only for AI messages and only for values within 0 to 1.
  - Assignee names are not resolvable from the browser (the member list needs `members_manage`), so only "You" (staff),
    "A team member" or "Unassigned" is shown.
  - **Server limits.** The API filters by `state`, `priority`, `is_lead` and `tag` only, orders by creation time **oldest
    first**, and has no text search or latest-activity sort. Search and sort therefore run in the browser over what is
    loaded, and the list says so.
- **No placeholder endpoints.** Every function in `src/api/` calls a real endpoint. For a screen whose endpoint does
  not exist yet (`/comments`, `/automations`), render an explicit unavailable state: no fabricated data, no fake
  success. The old shared `NotYetAvailable` component was deleted once nothing used it.
- **Retries.** Only network failures and `AUTH_PROVIDER_UNAVAILABLE` are retried (bounded).
- **Design.** All colors, radii, shadows, fonts and motion are tokens in `src/index.css` (`@theme`).
- **No dead code.** A primitive is added together with the first screen that uses it.

## Status

| Screen                                                                  | State                                                                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1. Auth shell (Clerk sign-in/up, guard, layout, error boundary, toasts) | Done                                                                                  |
| 2. Onboarding (9 steps) + Instagram connection and OAuth return page    | Done. Answers are kept in the browser while filling in, then saved to the API on activation |
| 3. Dashboard (live Instagram health + role-aware analytics)             | Done. Live analytics API with a 7/30/90-day period selector                           |
| 4. Inbox (3 panes, 4 conversation states, takeover / hand-back, notes)  | Done. Live API; see Known follow-ups for list ordering                                |
| Handoff queue (waiting and resolved views, live counts)                 | Done. Live API; polls the waiting list; inbox actions refresh it; see Known follow-ups |
| 5. Automation rules                                                     | Next                                                                                  |
| 6. Knowledge base                                                       | Done. Owners and admins: list, filter, add, edit, delete, and a retrieval test box    |
| 7a. Settings (assistant behaviour, business profile)                    | Done. Owners/admins; live API; see Known follow-ups                                   |
| 7b. Usage (AI requests and estimated cost)                              | Done. Owners/admins; live API; see Known follow-ups                                                                               |
| 8. Role-aware UI (permission helper, applied per screen)                | Started: dashboard analytics, onboarding activation, knowledge base, sidebar and mobile menu |

## Known follow-ups

- **Inbox list order (backend).** `GET /conversations` pages by `created_at` ascending (`keyset_page`), so page 1 of a
  large inbox is the _oldest_ 50 conversations and a new one needing a person can be several "Load more" clicks away.
  The index `ix_conversations_inbox (organization_id, state, last_message_at)` suggests newest-activity-first was the
  intent. A newest-first option (and a `q` search parameter) on the API would let the browser stop sorting and
  searching locally. Until then, filtering by status ("Needs a person") is the reliable way to triage.
- **Assignment (backend).** `assigned_user_id` is only ever set by taking a conversation over, and staff see only
  conversations assigned to them, so a staff member has no way to receive one yet. The inbox is correct for them; it is
  simply empty until an assign endpoint exists.
- **Resolved handoffs order (backend).** `GET /handoffs` pages by `created_at` ascending like every list, which is right
  for the waiting queue (longest-waiting first) but means the resolved history starts with the _oldest_ handoffs, so a
  long history needs several "Load more" clicks to reach recent ones. A newest-first option for `status=resolved` would
  fix it. The screen shows what the server returns.
- **Usage** (`/usage`, `settings_manage`: owners and admins; managers get 403 from the server). Period selector (7, 30
  or 90 UTC days, the same as the dashboard), summary cards (estimated cost, requests with failures, tokens, average
  response time), requests per day (recharts, lazy-loaded, with an accessible table that adds each day's cost) and
  tables by purpose and by model. Costs are decimal strings end to end: the schema accepts only plain fixed-point text,
  and `formatUsd` formats the string itself (Intl decimal-string formatting, exact half-up rounding, no float), showing
  up to four decimals below a dollar and "<$0.0001" for a non-zero amount too small to show. When `unpriced_requests`
  is above zero a warning says the cost is understated instead of showing a confident total. `purpose` is free text on
  the wire, so an unfamiliar one is shown readably, not rejected. Known gaps: the average response time includes failed
  requests (the backend averages every recorded request), the chart plots requests rather than cost, and there is no
  plan limit or budget comparison (the backend has none).
- **Settings** (`/settings`, `settings_manage`: owners and admins; the server enforces it too). Two independent sections:
  the assistant (reply switches, the minimum-confidence and reply-style sliders as whole percents, reply length, replies
  per conversation per hour) and the business profile (text fields, tone, contact details and policies as editable rows).
  The assistant form sends only what changed and never an empty update (the server answers 422); a switch the workspace
  has not enabled is not shown and never touched; private replies are only offered while comment replies are on and are
  turned off with them. The profile form validates with the backend's exact limits and PUTs the whole profile. Both
  forms reset to what the server returns after a save, and both read fresh data on every visit so a stale editor cannot
  overwrite a change made elsewhere. Known gaps: no unsaved-changes warning when navigating away, and the profile's
  products live in the Knowledge screen, not here.
- The handoff queue has no per-handoff actions: a handoff only moves when the conversation does (takeover, hand-back,
  resolve), so each row links into the inbox where those buttons live.
- `GET /conversations/{id}` marks the conversation read as a side effect; the UI refreshes the list after opening one.

- **Activation saves for real** (`saveBusinessSetup`, owners and admins only, matching `settings_manage`), in this
  order so a failure can never leave replies on over a half-saved business, and so every step is safe to repeat:
  1. `GET` then `PUT /business/profile`. The PUT replaces the whole profile, so the answers are laid over what is
     stored: location, contact details and policies survive. Category becomes `industry`, tone becomes
     `communication_style`, notes become `custom_instructions`; blank website and notes are sent as `null`.
  2. Products and services become knowledge entries (`kind` product/service, the price and link written into the
     text the assistant reads). An entry with the same kind and name is updated, not duplicated; nothing is deleted.
  3. `PATCH /settings/ai` with `dm_automation_enabled`, `comment_automation_enabled` and `private_reply_enabled`, last.

  The calls, bodies and responses were checked against the real backend on PostgreSQL (see ARCHITECTURE.md).
- **Knowledge base** (`src/features/knowledge`, route `/knowledge`, owners and admins; managers and staff get an
  explanation and the sidebar link is hidden, while the server still enforces it). Entries load 20 at a time, oldest
  first, with a server-side type filter. Add and edit are inline (there is no dialog component); delete is a two-step
  confirm. Edit sends only the fields that changed and nothing when none did. A box runs the assistant's own retrieval
  (`POST /knowledge/search`) and lists matches best first; it does not show the score, which is a ranking value that
  means nothing to an owner, and it says that matching is by whole words. Deliberately not editable yet: an entry's
  `attributes` (they are untouched by edits), and search over the list itself.
- **Automation step.** It offers only what the backend can store: reply to comments, reply to direct messages, and
  "Continue a comment in private" (`private_reply_enabled`; off by default like on the server). The private option is
  shown only while comment replies are on and the server's `FEATURE_PRIVATE_REPLY` capability is enabled, and
  `normalizeAutomation` forces it off otherwise, because a private reply answers a comment. Handoffs are not settings:
  the screen states when the assistant hands over (`HANDOFF_RULES`, which mirrors the backend and must change with it).
  Earlier the review screen promised handoffs on request and on complaints, which the pipeline never did explicitly.
- Onboarding has no server-side "completed" flag, so a user with a workspace is not forced back into it; the sidebar
  keeps a "Setup guide" link.
- The initial bundle is dominated by Clerk and React (~440 kB min, ~130 kB gzip). Recharts (~366 kB) is a separate
  chunk loaded only when analytics data exists.
- `src/api/analytics.ts` was reconciled with the real `/api/v1/analytics/overview` response. The old guessed shape had
  an `automation_rate` and a `human_replies` series that the API does not provide; they were dropped rather than
  estimated. The response was checked by parsing a genuine one captured from the backend on PostgreSQL. The vitest
  config pins `TZ=America/Los_Angeles` so a date helper that follows the viewer's clock instead of UTC fails here.
- The `/usage` endpoint (owner/admin only) has no frontend client yet.
- **Navigation on small screens.** The sidebar only exists from the `md` breakpoint (48rem) up. Below it, a menu
  button in the header opens a modal drawer (`components/layout/mobile-nav.tsx`) with the same links: both read one
  list (`nav-items.ts`), so role gating and the page set can never differ between them. The drawer moves focus in and
  returns it to the button, closes on Escape, on the dimmed backdrop, on choosing a page (including the current one) and
  on any route change, keeps Tab inside it, and stops the page behind from scrolling. Verified in jsdom and by checking
  the built CSS (both `md:` rules sit inside `@media (width >= 48rem)`); it has not been looked at in a real browser or
  on a phone, and there is no swipe-to-close or open/close animation. The header's brand, workspace switcher and
  account button share one row at ~375px and have not been checked for crowding.
- `GET /auth/me` has no caller now that the temporary "Signed in" card is gone (it was the only user, so the wrapper was
  removed as dead code). Re-add `fetchIdentity` when a screen needs the identity, for example the admin flag.
- No CSP header yet: Clerk's frontend API host is instance-specific and needs to be templated into nginx.
