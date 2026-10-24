# Frontend handover prompt

Paste everything below the line into your AI coding tool from the repo root.

---

You are a senior frontend engineer joining the Instomation project (repo: RohitThanvi/Instomation).
Before writing code, read `README.md`, `docs/ARCHITECTURE.md` and `docs/DATABASE.md` fully. The README
"Engineering rules" are mandatory: production-grade only, no dummy or dead code, no hardcoded values,
optimised code, tests with features.

## Goal

Build `frontend/` as a Vite SPA for an AI-powered Instagram marketing assistant (multi-tenant SaaS).

## Stack (fixed)

React, Vite, TypeScript (strict), React Router, Tailwind CSS, shadcn/ui, TanStack Query,
React Hook Form, Zod, Recharts, Lucide icons, Clerk (`@clerk/clerk-react`). **No Next.js.**

## Backend contract (current state; do not invent endpoints)

- Base URL from env `VITE_API_BASE_URL`; never hardcode it. Send `Authorization: Bearer <Clerk session token>`
  on every API call and an `X-Request-ID` (8-64 chars of `A-Za-z0-9._-`; anything else is replaced server-side).
- Errors always use `{ "error": { "code": string, "message": string } }`. Build one API client that parses this
  into a typed `ApiError`, and show `message` to users. Codes so far: `UNAUTHENTICATED` (401),
  `AUTH_PROVIDER_UNAVAILABLE` (503, retry), `PERMISSION_DENIED` (403), `ORGANIZATION_REQUIRED` (400),
  `ORGANIZATION_ACCESS_DENIED` (403), `MEMBER_NOT_FOUND` (404), `LAST_OWNER` (409), `INVALID_CURSOR` (400),
  `VALIDATION_ERROR` (422), `INSTAGRAM_ACCOUNT_NOT_FOUND` (404), `INTERNAL_ERROR` (500).
- **Tenant selection:** the server derives the organization from the Clerk identity. A user in exactly one
  organization needs nothing extra; a user in several must send `X-Organization-ID: <uuid>` (only organizations
  the user belongs to are accepted). With none, tenant endpoints return `ORGANIZATION_REQUIRED`: show onboarding.
- **Pagination:** list endpoints take `?limit=&cursor=` (limit 1-100) and return `{ items, next_cursor }`; use
  `useInfiniteQuery`.
- Live endpoints:
  - `GET /health`, `GET /ready`
  - `GET /api/v1/auth/me` -> `{ clerk_user_id }`
  - `POST /api/v1/organizations` `{ name, account_type: creator|business|agency|personal_brand|other }` -> `{ id, name, account_type, role }`
  - `GET /api/v1/organizations` (paginated, the caller's organizations with their role)
  - `GET /api/v1/organizations/current/members` (paginated) -> `{ membership_id, user_id, email, full_name, role }`
  - `PATCH|DELETE /api/v1/organizations/current/members/{membership_id}` (`{ role }`; needs `members_manage`)
  - `GET /api/v1/instagram/capabilities` -> `[{ feature, enabled, reason }]` where `feature` is `FEATURE_COMMENT_REPLY`,
    `FEATURE_COMMENT_LIKE`, `FEATURE_DM_REPLY`, `FEATURE_PRIVATE_REPLY`, `FEATURE_PROFILE_BIO_UPDATE` or
    `FEATURE_PROFILE_PHOTO_UPDATE`; comment like / bio / photo are
    always disabled (Meta exposes no API): never render controls for a disabled capability.
  - `POST /api/v1/instagram/oauth/start` -> `{ authorization_url }`: navigate the browser to it. Meta returns to
    the backend, which redirects to `<origin>/settings/instagram?status=connected` or
    `?status=error&reason=<CODE>` (`INVALID_OAUTH_STATE`, `AUTHORIZATION_DENIED`,
    `INSTAGRAM_ACCOUNT_NOT_PROFESSIONAL`, `ACCOUNT_ALREADY_CONNECTED`, `PERMISSION_DENIED`,
    `INSTAGRAM_UNAVAILABLE`, `INSTAGRAM_CONNECTION_FAILED`, `INTERNAL_ERROR`). Handle every reason with a clear message.
  - `GET /api/v1/instagram/accounts` (paginated) -> `{ id, username, status: active|token_expired|disconnected,
granted_permissions, webhook_subscribed, token_expires_at }`. Show `token_expired` as "reconnect required" and
    `webhook_subscribed=false` as "not receiving messages yet"; never claim the assistant is live in those states.
  - `DELETE /api/v1/instagram/accounts/{id}` (disconnect)
  - Knowledge base (needs `settings_manage`, i.e. owner/admin; manager and staff get 403, so hide the screen):
    - `GET /api/v1/knowledge/entries?kind=&cursor=&limit=` (paginated, oldest first) -> `{ id, kind:
      faq|product|service|policy|website|custom, title, content, attributes, created_at, updated_at }`
    - `POST /api/v1/knowledge/entries` `{ kind, title, content, attributes? }` -> 201 entry. Limits: title 1-300,
      content 1-4000 characters (trimmed); `attributes` is a flat object of at most 20 keys (names 1-50 chars,
      values string <=500 / number / boolean / null; no nesting). 409 `KNOWLEDGE_LIMIT_REACHED` when the
      organization is at its entry cap: show the message, do not retry.
    - `GET|PATCH|DELETE /api/v1/knowledge/entries/{id}`. PATCH is partial (omit a field to keep it; null is not
      accepted; send `attributes: {}` to clear them); an empty PATCH is 422. DELETE returns 204.
    - `GET|PUT /api/v1/business/profile` (owner/admin; built: `src/features/settings`). PUT replaces the whole profile, so submit the full form: a
      field left out is cleared. `{ brand_name<=200, description<=2000, industry<=120, location<=200, website
      (http/https URL), contact_info{<=10 items, value<=200}, policies{<=10 items, value<=500}, communication_style:
      strict_business|professional|moderately_casual|friendly, custom_instructions<=2000 }`. GET returns the same
      shape (empty values until saved). Anything else is 422.
    - `GET|PATCH /api/v1/settings/ai` (owner/admin; built: `src/features/settings`) -> `{ dm_automation_enabled, comment_automation_enabled,
      private_reply_enabled, confidence_threshold 0-1, max_response_tokens 50-1000, temperature 0-1, max_replies_per_conversation_per_hour
      1-100 }`. PATCH takes any subset (at least one). `dm_automation_enabled` is the master switch for AI replies to
      DMs; nothing is answered or even classified until it is on. `comment_automation_enabled` is the independent master switch for
      public AI replies to comments (it does not depend on the DM switch). `private_reply_enabled` (off by default)
      additionally lets the assistant send the commenter one private message with details; it only has an effect
      while comment replies are on and `FEATURE_PRIVATE_REPLY` is enabled (see capabilities). Public replies appear in the same
      conversation thread as outbound `origin: ai` messages. Every message carries `channel`: `dm`, `comment` (a
      customer's public comment or our public reply to it) or `private_reply` (our DM to a commenter), and `null` for
      an internal note; use it to label them.
    - Handoff queue (built: `src/api/handoffs.ts`, `src/features/handoffs`; any member; staff only see conversations assigned to them, like the conversation list):
      `GET /api/v1/handoffs?status=&cursor=&limit=` lists conversations that need a person, longest-waiting first.
      Without `status` it returns unresolved ones (`open`, `assigned`); `status=resolved` is the history. Item:
      `{ id, conversation_id, customer{id,external_user_id,username,display_name}, conversation_state,
      conversation_priority, reason: low_confidence|missing_information|threat|complaint|manual|..., status,
      assigned_user_id, created_at, resolved_at }`. `GET /api/v1/handoffs/counts` -> `{ open, assigned }` for a badge.
      Handoffs move by themselves: `POST /conversations/{id}/takeover` -> `assigned` (to the caller),
      `/hand-back` and `/resolve` -> `resolved`. There is no endpoint to edit a handoff directly.
    - Analytics (owner/admin/manager; staff get 403). Query params `from` and `to` are UTC dates, `to` inclusive;
      default is the 30 days ending today; at most 366 days; `from` after `to` or a longer range is 422
      `INVALID_RANGE`. Days are UTC because organizations have no timezone setting yet, so a chart's "today" can differ
      from the owner's local day.
      `GET /api/v1/analytics/overview` -> `{ range{start,end}, conversations{new, new_leads, by_state{ai_active,
      human_required, human_active, resolved}} (by_state is a snapshot of right now, not of the range),
      messages{inbound, outbound_ai, outbound_human, outbound_failed} (internal notes excluded),
      automation{ai_replies_sent, handoffs_opened, handoffs_resolved, handoffs_by_reason{...}} (every reason present,
      zero when none), moderation{allowed, blocked, escalated, blocked_by_category{spam|sexual|offensive: n}},
      daily[{date, inbound, outbound}] }` (one entry per day in the range, zero-filled, ready to chart).
    - Usage and cost (owner/admin only; managers and staff get 403). `GET /api/v1/usage?from=&to=` ->
      `{ range, totals{requests, input_tokens, output_tokens, estimated_cost}, failed_requests, unpriced_requests,
      average_latency_ms|null, by_purpose[{purpose, ..., estimated_cost}] (costliest first), by_model[{provider, model,
      ...}], daily[{date, requests, estimated_cost}] }`. `estimated_cost` is a decimal **string** in USD (do not
      parse it as a float). It is an estimate from a built-in price table. If `unpriced_requests` > 0 some requests used a
      model with no price on file, so the cost understates real spend: show a notice instead of a confident total.
    - `POST /api/v1/knowledge/search` `{ query (1-500), limit (1-20, default 5) }` -> `[{ entry, score }]`, best
      first. This is exactly what the assistant retrieves, so use it for a "test your knowledge base" box.
      Matching is by whole words (no stemming): "ship" does not match "shipping". Say so in the UI hint.
- Roles: `owner`, `admin`, `manager`, `staff` (lowercase on the wire, as are all enum values such as instagram
  account `status` and `account_type`). Hide or disable UI by role, but the server is authoritative (403).
- **Conversations are live** (inbox): `GET /api/v1/conversations` (filters `state|priority|is_lead|tag`, oldest first),
  `GET|PATCH /conversations/{id}`, `POST /conversations/{id}/{takeover,hand-back,resolve}`,
  `GET|POST /conversations/{id}/messages` (reply only while `human_required|human_active`, else 409), and
  `POST /conversations/{id}/notes`. Enums are lowercase (`ai_active`, `human_required`, `human_active`, `resolved`).
  Codes: `CONVERSATION_NOT_FOUND` (404), `CONVERSATION_NOT_HUMAN_CONTROLLED` (409).
- Planned, not built yet: `/api/v1/{comments,automations}` (no router exists; verified against `backend/app/api/v1/`).
  Code against typed interfaces in `src/api/`, and show an explicit "not available yet" state rather than fake data
  (there is currently no shared component for it: the old one was deleted when nothing used it).
- The browser never supplies a tenant it does not belong to and never sees Instagram tokens.
- Backend `CORS_ALLOWED_ORIGINS` and `CLERK_AUTHORIZED_PARTIES` must include the frontend origin.

## Screens (in this order)

1. Auth shell (Clerk sign-in/up), protected routes, app layout, error boundary, toasts.
2. Onboarding (9 steps): welcome, account type (creator/business/agency), connect Instagram, profile,
   products/services, communication style (strict business / professional / moderately casual /
   friendly), automation preferences, review (state clearly what the AI will and will not do), activate.
3. Dashboard overview: metric cards and charts (messages over time, conversations, leads, automation).
4. Inbox: 3 panes (list with search/filter/sort/tags/status/priority, conversation, customer context).
   Conversation states: AI_ACTIVE, HUMAN_REQUIRED, HUMAN_ACTIVE, RESOLVED. Show intent, AI confidence,
   lead status, internal notes, human takeover and hand-back controls.
5. Automation rules (structured IF/THEN, no visual workflow builder in V1).
6. Knowledge base (FAQs, products, services, policies).
7. Settings (Instagram, AI, business, automation, working hours), usage, and an internal admin area
   guarded by a server-provided platform-admin flag.
8. RBAC-aware UI (OWNER, ADMIN, MANAGER, STAFF): hide or disable by role, but the server is the authority.

## Design

Premium modern light SaaS: clean, serene, mature, vibrant accent used sparingly, strong typography,
generous whitespace, subtle shadows, refined borders, smooth transitions. Not dark, not neon, no
gradient overload, no "AI" clichés. Suitable for both influencers and professional businesses.
Desktop-first, usable on mobile. Reusable components: Button, Input, Textarea, Select, Modal, Drawer,
Tabs, Card, Badge, Avatar, Toast, Dropdown, DataTable, Chart, ChatBubble, ConversationList,
StatusIndicator, EmptyState, LoadingSkeleton, ErrorState. Design tokens via Tailwind theme, no magic values.

## Quality bar

Strict TS, no `any`, Zod-validated API responses and forms, route-level code splitting, TanStack Query
caching with sensible invalidation, accessible (keyboard, ARIA, contrast), ESLint + Prettier, Vitest +
Testing Library for components and hooks. Add `frontend/Dockerfile` (multi-stage, static serve) and a
`frontend` service in `docker-compose.yml`. Document env vars in `.env.example` (`VITE_API_BASE_URL`,
`VITE_CLERK_PUBLISHABLE_KEY`).

## Workflow

Work in small commits, one screen or feature at a time, and update the README phase table and add
`docs/FRONTEND.md` (structure, conventions, how to run and test). Run backend locally with
`docker compose up -d` plus `alembic upgrade head` (see README).
