# Instomation

AI-powered Instagram marketing assistant (multi-tenant SaaS). Customers connect an Instagram
Professional account through Meta's **official** APIs; the assistant handles comments and DMs in a
natural, human tone, detects leads, and hands off to a human when needed.

> **For AI agents and collaborators:** this README is the source of truth for project context.
> Read it and `docs/ARCHITECTURE.md` fully before changing code. The rules in
> [Engineering rules](#engineering-rules) are mandatory.

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Project setup, config, logging, tooling | Backend done; frontend scaffold done; CI workflow staged (see below) |
| F | Frontend (see `docs/FRONTEND.md`) | Screens 1-4 of 8 done (auth shell, onboarding, dashboard with live analytics, inbox); onboarding saves to the API on activation; knowledge base screen done (owners/admins); mobile navigation menu; automation rules next |
| 2 | Clerk authentication | Done (JWT verification, `GET /api/v1/auth/me`) |
| 3 | PostgreSQL models + Alembic | Done (23 tables; migrations `0001`-`0005`, head is `0005`) |
| 4 | Redis + worker system | Done (queues, durable jobs, retry/backoff, rate limits, locks, cron) |
| 5 | Multi-tenant organizations, RBAC | Done (tenant resolution, roles, org/member API; member invites pending) |
| 6 | Instagram OAuth + API abstraction | Done (OAuth, encrypted tokens, Graph client, token refresh cron) |
| 7-8 | Webhook receiver + event queue | Done (signed receiver, dedup, fast-return, EVENTS queue dispatch) |
| 9 | Conversations / messages | Done (customer/conversation/message resolution, event handlers, inbox API, human takeover) |
| 10 | AI gateway | Done (Groq/OpenAI abstraction, retry/backoff, circuit breaker, layered rate limits, cost tracking) |
| 11 | Moderation | Done (rules + LLM safety classifier, fail-closed policy, runs on the `ai` queue before any reply; live-provider check pending, see below) |
| 12 | Knowledge base | Done (entries CRUD + full-text retrieval API, per-org cap, tenant-scoped, audited; website/file ingestion not included) |
| 13 | DM automation | Done (moderated DMs get a grounded AI reply or a human handoff; configurable via `/business/profile` and `/settings/ai`; failed sends and exhausted AI jobs escalate to a human; fail-closed gates; queued through the existing send job; delivery to Meta not yet verified, see ARCHITECTURE.md) |
| 14 | Comment automation | Done (moderated comments get a short grounded public reply or a human handoff; same fail-closed gates as DMs; private replies not included; delivery to Meta not yet verified) |
| 15 | Human takeover | Done (handoff lifecycle follows takeover / hand-back / resolve; handoff queue + counts API, role- and tenant-scoped; no auto-release or notifications) |
| 16-17 | Analytics and usage/cost API | Done (backend: `/analytics/overview` and `/usage`, UTC days, tenant- and role-scoped; no plan-limit comparison, no export) |
| 18 | Dashboard (frontend screens) | In progress: the dashboard's analytics are wired to the live API with a 7/30/90-day selector. Onboarding's activation saves the profile, products (as knowledge entries) and reply switches to the real API. Knowledge base screen is done. Not started: automation rules, business/AI settings, handoff queue, usage |
| 19-20 | Tests, deployment | Mostly done (compose runs one worker per queue with liveness checks; `.env.example` matches the code; deployment and worker-registry regression tests; coverage gate at 94% in `pyproject.toml`; `docs/DEPLOYMENT.md`; CI staged in `docs/ci/` with migration-drift and frontend jobs; the API and every worker verified as real processes. Pending: a real container run, because the compose stack and images have never been built, and activating the staged workflows) |

Update this table in the same commit that completes a phase.

## Stack

- **Frontend:** React, Vite, TypeScript, React Router, Tailwind CSS, shadcn/ui, TanStack Query,
  React Hook Form, Zod, Recharts, Lucide. Vite SPA. **No Next.js.**
- **Backend:** Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2.x (async), Alembic, PostgreSQL, Redis,
  ARQ workers (async Redis-backed queue).
- **Auth:** Clerk (JWT validated server-side against JWKS). No custom password auth.
- **AI:** Groq primary behind an `AIProvider` interface; OpenAI as optional fallback.
- **Infra:** Docker, Docker Compose. Modular monolith + workers. No Kubernetes.

## Zero-cost launch profile

| Layer | Free option |
|---|---|
| Frontend | Cloudflare Pages / Vercel |
| API + worker | Single container (Fly.io or Oracle Cloud Always Free); worker is a separate process of the same image |
| PostgreSQL | Neon / Supabase free tier |
| Redis | Redis container on the same VM (recommended, free, no quota). Upstash free tier works but its command quota can be consumed by worker polling; raise `WORKER_POLL_DELAY_SECONDS` if you use it |
| Auth | Clerk free tier |
| AI | Groq free tier |

No architecture decision may depend on a specific free tier. Hosts are swapped through env vars only.

## Meta / Instagram principles

Only officially supported APIs via OAuth. Never: browser automation, scraping, stored passwords,
session cookies, limit-bypass tricks.

Every Instagram action sits behind a capability flag and an adapter interface:

| Flag | Default | Note |
|---|---|---|
| `FEATURE_COMMENT_REPLY` | on | Supported |
| `FEATURE_DM_REPLY` | on | Supported (messaging window rules apply) |
| `FEATURE_PRIVATE_REPLY` | on | Supported, and opt-in per organization (`private_reply_enabled`, off by default): one private DM to a commenter next to the public reply; Meta allows one per comment, within 7 days |
| `FEATURE_COMMENT_LIKE` | **off** | Not exposed by the official API; UI must not advertise it |
| `FEATURE_PROFILE_BIO_UPDATE` | **off** | Not exposed |
| `FEATURE_PROFILE_PHOTO_UPDATE` | **off** | Not exposed |

Verify against current Meta docs before enabling anything. Serving accounts other than your own/testers
requires Meta App Review and Business Verification; development mode works for the app's own roles.
Development-only mocks must be clearly labeled and never enabled in production.

## Repository layout

```
backend/   FastAPI app, workers, migrations, tests
frontend/  Vite SPA
docs/      ARCHITECTURE, DATABASE, SECURITY, FRONTEND, FRONTEND_HANDOVER, DEPLOYMENT, ci/ (staged workflows)
```

## Engineering rules

1. Production-grade only: no dummy code, no dead code, no hardcoded values (config via env/settings).
2. Webhook handlers never call the LLM. Validate signature -> persist -> enqueue -> return 200.
3. PostgreSQL is the source of truth; Redis holds queues, locks, rate limits, caches only.
4. Every tenant-owned row has `organization_id`; it is **always** resolved server-side from the
   Clerk identity and membership, never taken from client input.
5. Idempotency everywhere: unique `external_event_id` / `external_message_id` / `external_comment_id`.
6. Per-conversation Redis lock (with TTL) for ordered replies.
7. Never log tokens, keys, passwords, or personal data. Encrypt Instagram tokens at rest (Fernet).
8. Customer text and knowledge-base text are untrusted data, never instructions (prompt-injection defense).
9. Consistent error envelope: `{"error": {"code": "...", "message": "..."}}`.
10. All list endpoints paginate (cursor for high-volume). Every schema change ships an Alembic migration.
11. Type hints throughout; small modules; dependency injection; tests alongside features.
12. Never fake success states (sends, likes, connections, analytics) in production paths.

## Local development

```bash
cp .env.example .env            # fill in values
docker compose up -d            # postgres, redis, migrate, api, one worker per queue, frontend
```

The compose stack and its images have never been built or run (there was no Docker in the development
sandbox); treat them as unverified until you have run them. Without Docker, run the processes directly:

```bash
cd backend && pip install -r requirements-dev.txt && alembic upgrade head
uvicorn app.main:app --reload                                       # API
WORKER_QUEUE=events arq app.workers.settings.WorkerSettings         # repeat for ai, instagram, maintenance

# backend checks (tests need a real PostgreSQL and Redis: TEST_DATABASE_URL, TEST_REDIS_URL)
ruff check . && ruff format --check . && mypy app && alembic check && pytest --cov

cd ../frontend && npm ci && npm run lint && npm run typecheck && npm run format:check && npm test && npm run build
```

## Environment variables

See `.env.example` (documented inline). Never commit real secrets.

## Documentation index

- `docs/ARCHITECTURE.md`: system design, data flow, concurrency, failure handling.
- `docs/DATABASE.md`: schema conventions, tables, indexes, tenancy and idempotency rules.
- `docs/FRONTEND.md`: frontend structure, conventions, run/test, screen status.
- `docs/SECURITY.md`: auth, tenancy, secrets, token handling, retention on disconnect.
- `docs/FRONTEND_HANDOVER.md`: API contracts and conventions for building the remaining screens.
- `docs/DEPLOYMENT.md`: process layout, environment, migrate-on-release, scaling rules, Meta webhook setup, free-tier path.

## Database and migrations

```bash
cd backend
alembic upgrade head                              # apply migrations
alembic revision --autogenerate -m "message"      # after changing models; review the output
alembic check                                     # fails if models and migrations drift
```

Integration tests need real PostgreSQL and Redis (use a dedicated Redis DB; it is flushed):

```bash
TEST_DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/instomation_test \
TEST_REDIS_URL=redis://localhost:6379/1 pytest -q
```

Without both variables the integration tests are skipped.

Never edit a schema by hand; every change ships an Alembic migration. See `docs/DATABASE.md`.

## CI

Two workflows are staged in `docs/ci/`: `backend-ci.yml` (ruff, format check, mypy, `alembic upgrade head`
followed by `alembic check` on an empty database to catch migration drift, then pytest with the coverage
gate against PostgreSQL and Redis services) and `frontend-ci.yml` (lint, typecheck, format check, test,
build). Their commands were run locally; the workflows themselves have not run on GitHub. GitHub only
accepts pushes to `.github/workflows/` from a token with the `workflow` scope, so activate them by copying
both files to `.github/workflows/` (via the web UI or such a token) and deleting the staged copies.

Coverage is configured in `backend/pyproject.toml` with `concurrency = ["greenlet", "thread"]`; without it
SQLAlchemy-async code is badly under-reported (88% instead of 94% overall when first measured). The gate
(`fail_under`) is 94%, about a point below the measured 95.13%; raise it as coverage grows.

## Workers

```bash
cd backend
WORKER_QUEUE=maintenance arq app.workers.settings.WorkerSettings   # one process per queue
```

Queues: `events`, `ai` (moderation and DM/comment reply generation), `instagram`, `maintenance`. A worker refuses to start for a queue with no
registered handlers. Handlers are wrapped with `tracked` (`app/workers/runtime.py`) and registered in
`app/workers/settings.py::HANDLERS`. Full design in `docs/ARCHITECTURE.md`.

## API (implemented so far)

| Method | Path | Notes |
|---|---|---|
| GET | `/health`, `/ready` | Liveness; readiness (DB + Redis) |
| GET | `/api/v1/auth/me` | Verified Clerk user id |
| POST | `/api/v1/organizations` | Creates org; caller becomes OWNER |
| GET | `/api/v1/organizations` | Caller's organizations (cursor-paginated) |
| GET | `/api/v1/organizations/current/members` | Members of the resolved tenant (paginated) |
| PATCH/DELETE | `/api/v1/organizations/current/members/{membership_id}` | Requires `members_manage` |

Tenant selection: send `X-Organization-ID` when the user belongs to several organizations. The server
verifies membership; with exactly one membership the header may be omitted. Pagination uses
`?limit=&cursor=` and returns `{items, next_cursor}`. Add-member/invitation flow is not built yet.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/instagram/capabilities` | Feature flags with reasons; unsupported ones are always `enabled=false` |
| POST | `/api/v1/instagram/oauth/start` | Returns `authorization_url` (needs `settings_manage`) |
| GET | `/api/v1/instagram/oauth/callback` | Meta redirect target; 303-redirects to `FRONTEND_BASE_URL` + `OAUTH_RESULT_PATH` with `?status=connected` or `?status=error&reason=<CODE>` |
| GET | `/api/v1/instagram/accounts` | Connected accounts (paginated); never returns tokens |
| DELETE | `/api/v1/instagram/accounts/{id}` | Disconnect (token wiped) |

| GET/POST | `/api/v1/instagram/webhooks` | Meta verification handshake and event delivery. Unauthenticated by design (protected by `X-Hub-Signature-256` and, for GET, the verify token); never call it from the frontend. |

| GET | `/api/v1/conversations` | Inbox list (paginated; filters `state`, `priority`, `is_lead`, `tag`). STAFF sees only conversations assigned to them. |
| GET/PATCH | `/api/v1/conversations/{id}` | Fetch (marks read) / update priority, tags, lead flag |
| POST | `/api/v1/conversations/{id}/takeover`, `/hand-back`, `/resolve` | Conversation state transitions |
| GET | `/api/v1/conversations/{id}/messages` | Message history (paginated) |
| POST | `/api/v1/conversations/{id}/messages` | Human reply — only while AI is silenced (`human_required`/`human_active`); delivered asynchronously via the `instagram` queue |
| POST | `/api/v1/conversations/{id}/notes` | Internal note (never sent to Instagram) |

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/handoffs` | Handoff queue, longest-waiting first (cursor-paginated; `status` filter, default unresolved). STAFF sees only conversations assigned to them. |
| GET | `/api/v1/handoffs/counts` | Counts for the queue badge; same scoping |
| GET/PUT | `/api/v1/business/profile` | Brand profile, policies and communication style the AI answers from (requires `settings_manage`) |
| GET/PATCH | `/api/v1/settings/ai` | DM, comment and private-reply switches, confidence threshold, token and temperature limits, hourly reply cap (requires `settings_manage`) |
| GET/POST | `/api/v1/knowledge/entries` | List / create knowledge entries (requires `settings_manage`; per-org cap `KNOWLEDGE_MAX_ENTRIES`) |
| GET/PATCH/DELETE | `/api/v1/knowledge/entries/{id}` | Fetch / update / soft-delete an entry (requires `settings_manage`) |
| POST | `/api/v1/knowledge/search` | Full-text retrieval over active entries (requires `settings_manage`) |
| GET | `/api/v1/analytics/overview` | Conversation, message, automation and moderation statistics plus a daily series, over a UTC date range (requires `analytics_view`) |
| GET | `/api/v1/usage` | AI requests, tokens and estimated cost by purpose, model and day, with unpriced requests counted separately (owner/admin only: requires `settings_manage`) |

This table lists every endpoint in the generated OpenAPI document (35, including `/health` and `/ready`)
plus the two Meta-facing routes that are deliberately excluded from it: `/api/v1/instagram/webhooks` and
`/api/v1/instagram/oauth/callback`. Request and response shapes: `/docs` in development, and
`docs/FRONTEND_HANDOVER.md`.
