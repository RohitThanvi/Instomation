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
| F | Frontend (see `docs/FRONTEND.md`) | Screens 1-3 of 8 done (auth shell, onboarding, dashboard); inbox next |
| 2 | Clerk authentication | Done (JWT verification, `GET /api/v1/auth/me`) |
| 3 | PostgreSQL models + Alembic | Done (23 tables, migration `0001`) |
| 4 | Redis + worker system | Done (queues, durable jobs, retry/backoff, rate limits, locks, cron) |
| 5 | Multi-tenant organizations, RBAC | Done (tenant resolution, roles, org/member API; member invites pending) |
| 6 | Instagram OAuth + API abstraction | Done (OAuth, encrypted tokens, Graph client, token refresh cron) |
| 7-8 | Webhook receiver + event queue | Done (signed receiver, dedup, fast-return, EVENTS queue dispatch) |
| 9 | Conversations / messages | Done (customer/conversation/message resolution, event handlers, inbox API, human takeover) |
| 10 | AI gateway | Done (Groq/OpenAI abstraction, retry/backoff, circuit breaker, layered rate limits, cost tracking) |
| 11 | Moderation | Done (rules + LLM safety classifier, fail-closed policy, runs on the `ai` queue before any reply; live-provider check pending, see below) |
| 12 | Knowledge base | Done (entries CRUD + full-text retrieval API, per-org cap, tenant-scoped, audited; website/file ingestion not included) |
| 13-14 | DM + comment automation | Planned |
| 15 | Human takeover | Planned |
| 16-18 | Dashboard, analytics, usage/cost | Planned |
| 19-20 | Tests, deployment | Planned |

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
| `FEATURE_PRIVATE_REPLY` | on | Supported (comment -> DM, one per comment, time-limited) |
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
docs/      ARCHITECTURE.md (and API/DB/AI/SECURITY/DEPLOYMENT docs as they land)
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
docker compose up -d            # postgres, redis, api (worker and frontend join in later phases)
```

Detailed setup, migrations, worker, frontend and test commands are added as each phase lands.

## Environment variables

See `.env.example` (documented inline). Never commit real secrets.

## Documentation index

- `docs/ARCHITECTURE.md`: system design, data flow, concurrency, failure handling.
- `docs/DATABASE.md`: schema conventions, tables, indexes, tenancy and idempotency rules.
- `docs/FRONTEND.md`: frontend structure, conventions, run/test, screen status.
- `docs/SECURITY.md`: auth, tenancy, secrets, token handling, retention on disconnect.

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

The backend workflow is staged at `docs/ci/backend-ci.yml` (ruff, format check, pytest with Postgres and
Redis services). GitHub only accepts pushes to `.github/workflows/` from a token with the `workflow`
scope, so activate it by copying the file to `.github/workflows/backend-ci.yml` (via the web UI or a
token with that scope), then delete the staged copy.

## Workers

```bash
cd backend
WORKER_QUEUE=maintenance arq app.workers.settings.WorkerSettings   # one process per queue
```

Queues: `events`, `ai` (moderation; reply generation joins in Phases 13-14), `instagram`, `maintenance`. A worker refuses to start for a queue with no
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
