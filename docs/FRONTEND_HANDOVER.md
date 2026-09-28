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
- Base URL from env `VITE_API_BASE_URL`; never hardcode it.
- Auth: send the Clerk session token as `Authorization: Bearer <token>` on every API call.
- Available now: `GET /health`, `GET /ready`, `GET /api/v1/auth/me` -> `{ "clerk_user_id": string }`.
- Errors always use `{ "error": { "code": string, "message": string } }`. Build one API client that
  parses this envelope into a typed `ApiError`, and show `message` to users. Known codes so far:
  `UNAUTHENTICATED` (401), `AUTH_PROVIDER_UNAVAILABLE` (503), `VALIDATION_ERROR` (422),
  `INTERNAL_ERROR` (500).
- Send `X-Request-ID` (uuid) per request; the backend echoes it.
- Planned routers (not built yet): `/api/v1/{instagram,conversations,messages,comments,automations,
  business,knowledge,analytics,settings,usage}`. Code against typed interfaces in `src/api/`, keep
  each module behind its own service file, and mark screens whose endpoint is not live as
  "not yet available" states. Never fake data or success states in production paths. Any
  development-only mock must be clearly labeled and disabled in production builds.
- The browser never supplies `organization_id`; the server resolves the tenant from the Clerk identity.
- The frontend never sees Instagram tokens.
- Instagram capabilities come from the server. Comment likes, bio and photo updates are NOT
  supported by Meta's API: the UI must not advertise them unless the server reports the capability on.
- List endpoints will be cursor-paginated: use `useInfiniteQuery`, debounce search, virtualize long lists.

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
`VITE_CLERK_PUBLISHABLE_KEY`). Backend `CORS_ALLOWED_ORIGINS` and `CLERK_AUTHORIZED_PARTIES` must
include the frontend origin.

## Workflow
Work in small commits, one screen or feature at a time, and update the README phase table and add
`docs/FRONTEND.md` (structure, conventions, how to run and test). Run backend locally with
`docker compose up -d` plus `alembic upgrade head` (see README).
