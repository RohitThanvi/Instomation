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
| 1 | Project setup, config, logging, tooling | In progress |
| 2 | Clerk authentication | Planned |
| 3 | PostgreSQL models + Alembic | Planned |
| 4 | Redis + worker system | Planned |
| 5 | Multi-tenant organizations, RBAC | Planned |
| 6 | Instagram OAuth + API abstraction | Planned |
| 7-8 | Webhook receiver + event queue | Planned |
| 9 | Conversations / messages | Planned |
| 10-11 | AI gateway + moderation | Planned |
| 12 | Knowledge base | Planned |
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
| Redis | Upstash free tier (request-quota aware: batch calls, no polling loops) |
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
docker compose up -d            # postgres, redis, api, worker, frontend (added in Phase 1)
```

Detailed setup, migrations, worker, frontend and test commands are added as each phase lands.

## Environment variables

See `.env.example` (documented inline). Never commit real secrets.

## Documentation index

- `docs/ARCHITECTURE.md`: system design, data flow, concurrency, failure handling.
