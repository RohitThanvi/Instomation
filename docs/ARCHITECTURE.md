# Architecture

## Event flow

```
Meta webhook -> FastAPI receiver -> verify signature -> persist webhook_events (unique external id)
  -> enqueue (Redis/ARQ) -> 200 OK
Worker: normalize -> language -> safety classify -> intent classify -> business rules
  -> knowledge retrieval -> context (recent msgs + summary + facts) -> AI gateway
  -> response validator -> Instagram send | ignore | escalate
```

The receiver does no slow work. If the AI provider is down the event is already persisted and the job
retries with exponential backoff and jitter, honoring `Retry-After`. Retries are bounded.

## Modules (modular monolith)

`api` (routers, v1) - `core` (config, security, errors, logging) - `db` - `models` - `schemas` -
`repositories` - `services/{instagram,ai,conversations,comments,moderation,knowledge,analytics}` -
`workers`.

## Multi-tenancy

Tenant = organization. Roles: OWNER, ADMIN, MANAGER, STAFF. Tenant resolved from verified Clerk JWT +
`organization_members`. Repositories always filter by `organization_id`.

## Concurrency and ordering

- Queues smooth bursts; per-account, global, per-user concurrency limits.
- Conversation-level distributed lock (Redis, TTL) ensures replies are sent in message order.
- Layered rate limits: global -> tenant -> IG account -> conversation -> AI provider.

## Loop and abuse protection

Track message origin; ignore events created by our own sends. Bound replies per conversation,
detect repeats, cap input length, treat all inbound text as untrusted.

## AI gateway

`AIProvider` (Groq, OpenAI, future). Health tracking, timeouts, retries, circuit breaker, fallback,
token and cost recording per request. No key rotation to evade limits.

## Conversation states

`AI_ACTIVE -> HUMAN_REQUIRED -> HUMAN_ACTIVE -> RESOLVED`. AI never replies in HUMAN_* states.

## Authentication (Phase 2)

`ClerkTokenVerifier` (`app/core/security.py`) validates Clerk session JWTs: RS256 only, signature via
cached JWKS, required `exp/iat/sub/iss`, issuer match, and `azp` checked against
`CLERK_AUTHORIZED_PARTIES`. An unknown `kid` triggers a JWKS refetch that is rate-limited
(`CLERK_JWKS_MIN_REFETCH_SECONDS`) so forged tokens cannot hammer Clerk. The dependency
`CurrentIdentity` yields an `Identity` with no tenant data; tenant resolution comes from
`organization_members` in Phase 5, never from client input.

## Workers, jobs and Redis primitives (Phase 4)

- **Durable enqueue** (`app/workers/queue.py`): `JobQueue.enqueue` commits a `jobs` row (PENDING) and
  then pushes to Redis using the row UUID as the arq job id, so duplicate pushes are ignored. If Redis
  is down the row stays PENDING and the `requeue_stale_jobs` cron (every 5 min, threshold
  `JOB_REQUEUE_AFTER_SECONDS`) pushes it later. Accepted work is never lost.
- **Handlers** (`app/workers/runtime.py`): `tracked(handler)` maintains job status/attempts, skips jobs
  already DONE, and turns `RetryableJobError(retry_after=...)` into an arq `Retry` using
  `RetryPolicy` (exponential 1s,2s,4s... capped, jitter factor 0.5-1.0, larger `Retry-After` wins,
  bounded by `JOB_MAX_TRIES`). Exhausted retries and unhandled errors end as FAILED and are visible to admins.
- **Queues** (`app/workers/queues.py`): events, ai, instagram, maintenance; one worker process per
  queue via `WORKER_QUEUE`; scale by running more processes.
- **Rate limiting** (`app/core/rate_limit.py`): atomic multi-layer check-then-consume in one Lua
  script (global -> tenant -> account -> conversation -> provider). A request denied by an inner layer
  consumes nothing from outer layers. Fixed windows (up to 2x burst at a boundary).
- **Locks** (`app/core/locks.py`): token-owned Redis lock with TTL for per-conversation ordering, and a
  lease semaphore (Redis clock, self-expiring) for per-account / per-provider concurrency caps.
- **Scheduler**: arq cron on the maintenance queue (`purge_finished_records` daily 03:17 UTC,
  `requeue_stale_jobs` every 5 minutes). No `sleep()` loops.
- Redis is never the source of truth: queue loss is repaired from PostgreSQL.

## Tenancy and RBAC (Phase 5)

- Request flow: `CurrentIdentity` (Clerk JWT) -> `CurrentUser` (JIT upsert, race-safe) -> `Tenant`
  (`resolve_tenant`: membership lookup; optional `X-Organization-ID` is only a *selection* checked
  against membership) -> `require(Permission.X)`.
- Permissions live in `app/core/rbac.py`. OWNER: all. ADMIN: all except `org_manage` and
  `billing_manage`. MANAGER: conversations, analytics, automation. STAFF: assigned conversations.
  Only owners may grant, revoke or modify OWNER; the last owner can never be demoted or removed.
- Every query on tenant data must filter by `TenantContext.organization_id`; cross-tenant ids return
  404 (or 403 for an organization the caller is not a member of). Covered by integration tests.
- Each request runs in one unit of work (`app/db/deps.py`): commit on success, rollback on error.
  Audit rows (`record_audit`) are staged in that same transaction.
- Pagination: stable `(created_at, id)` keyset via `app/core/pagination.py`; limit capped at 100.
