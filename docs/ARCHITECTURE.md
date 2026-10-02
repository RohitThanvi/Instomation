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

## Instagram integration (Phase 6)

Uses **Instagram API with Instagram Login** (host `graph.instagram.com`, version `META_GRAPH_API_VERSION`).
Endpoints and scopes were checked against Meta's current docs on 2026-09-28:

- Authorize: `https://www.instagram.com/oauth/authorize` (scopes `instagram_business_basic`,
  `instagram_business_manage_messages`, `instagram_business_manage_comments`).
- Code -> short-lived token: `POST https://api.instagram.com/oauth/access_token`; short -> long-lived (60 days):
  `GET graph.instagram.com/access_token`; refresh: `GET graph.instagram.com/refresh_access_token`.
- DM: `POST /{ig-id}/messages` with `recipient.id`; private reply: same endpoint with
  `recipient.comment_id` (one per comment, within 7 days); comment reply: `POST /{comment-id}/replies`;
  webhooks: `POST /me/subscribed_apps?subscribed_fields=...`.
- Standard Access covers accounts you own or added to the app; **Advanced Access (App Review + Business
  Verification) is required to serve other customers' accounts.**

Design: business code depends on the `InstagramApi` protocol (`app/services/instagram/client.py`),
never on HTTP. Tokens are sent in `Authorization` headers (the two exchange GETs need query params, and
httpx URL logging is disabled to keep them out of logs). Errors map to `InstagramApiError` with
`is_token_error / is_rate_limited / is_retryable` so callers can retry or ask for re-authorization.

Connection flow: `oauth/start` stores a single-use state (Redis, TTL `OAUTH_STATE_TTL_SECONDS`) bound to
user + organization; the callback consumes it atomically (`GETDEL`), exchanges tokens, verifies the account is
Business/Creator, encrypts the token with Fernet (`TokenCipher`, supports key rotation via
`TOKEN_ENCRYPTION_PREVIOUS_KEYS`), subscribes webhooks (failure is stored as `webhook_subscribed=false`,
never hidden) and audits. An Instagram account can belong to only one organization. Disconnect wipes the
token and keeps the row so conversation history stays attached on reconnect.

Capabilities (`FEATURE_*`): comment like, bio update and photo update are hard-coded off because Meta exposes
no endpoint; they cannot be enabled by configuration. Reply/DM/private-reply can be switched off per
environment. The `maintenance` cron `refresh_instagram_tokens` (daily 04:07 UTC) renews tokens expiring within
`TOKEN_REFRESH_WINDOW_DAYS` and marks accounts `token_expired` when re-authorization is needed.

Known constraint carried into Phase 13: DMs can only be sent to users who messaged first, within Meta's
messaging window; the DM sender must enforce this and treat rejections as non-retryable.

## Debug pass (2026-09-28)

A full audit against a real Postgres/Redis and a running server (not just the test client) found and
fixed:

1. **Silent data loss on commit failure.** `SessionDep` used FastAPI's default dependency scope, where
   the commit in `get_session` runs *after* the response is already sent — a failed commit (constraint
   violation, serialization failure) looked like success to the caller. Fixed with
   `Depends(get_session, scope="function")`, which runs commit/rollback before the response is sent.
   Regression: `tests/test_unit_of_work.py`.
2. **Unhandled exceptions lost the request ID and security headers**, because `BaseHTTPMiddleware`
   can't attach headers to a response FastAPI's own exception middleware builds after an unhandled
   error. Rewrote `RequestContextMiddleware` as pure ASGI so the 500 envelope is built *inside* it.
   Also: a malicious/malformed client `X-Request-ID` (log injection, oversized) is now validated and
   replaced. Regression: `tests/test_middleware.py`.
3. **`.env.example` was invalid.** Inline `# comment` text after several values (e.g.
   `CLERK_ISSUER=...  # https://...`) was parsed as part of the value, so a `docker compose up` using
   the example file as a starting point would fail or misbehave. Comments now sit on their own line;
   regression test parses the file with `python-dotenv` and asserts no value starts with `#`.
4. **JWKS verifier availability.** An outage combined with concurrent requests could trigger one Clerk
   fetch per request; a malformed JWKS document threw an unhandled `InvalidKeyError` instead of a 503;
   an expired-cache-but-Clerk-still-down case discarded already-good keys. Now: at most one upstream
   attempt per `min_refetch_seconds` regardless of concurrency, a failed refresh keeps serving cached
   keys when possible, and any refresh failure is a clean `AUTH_PROVIDER_UNAVAILABLE`. Added
   `CLERK_CLOCK_SKEW_SECONDS` (default 10) so minor client/server clock drift doesn't reject valid
   tokens. Regression: `tests/test_security.py`.
5. **OAuth callback did not re-check permission.** `oauth/start` correctly required
   `settings_manage`, but the callback (driven by Meta's redirect, not a fresh bearer-authenticated
   request) trusted the state alone. If the initiating member's role changed between start and
   callback, the connection would still complete. Added `require_permission` re-check in
   `complete_oauth`. Regression: `test_oauth_callback_rechecks_permission_if_role_changed_after_start`.
6. **Config inconsistencies not caught at startup.** Comma-separated list settings
   (`CORS_ALLOWED_ORIGINS`, `META_OAUTH_SCOPES`, etc.) were declared as plain `list[str]`, which
   pydantic-settings tries to parse as JSON — every list-valued env var was silently broken. Fixed with
   `NoDecode` plus explicit comma-splitting validators. Also added: production requires
   `CLERK_AUTHORIZED_PARTIES` and `CORS_ALLOWED_ORIGINS` to be set; `JOB_REQUEUE_AFTER_SECONDS` must
   exceed both `JOB_TIMEOUT_SECONDS` and `JOB_RETRY_CAP_SECONDS`, or a crashed job could be requeued
   while still legitimately retrying. Regression: `tests/test_settings.py`.
7. **Jobs stuck in PROCESSING were never recovered**, only PENDING ones — a worker killed mid-job left
   its job permanently invisible to the sweeper. `requeue_stale_jobs` now also requeues PROCESSING rows
   past the cutoff (safe: the arq job id deduplicates). Regression: `tests/integration/test_stuck_jobs.py`.
8. **Soft-deleted rows blocked re-creation.** `customers` and `conversations` had plain unique
   constraints on `(instagram_account_id, ...)`, so a soft-deleted row permanently blocked recreating
   the same customer/conversation. Replaced with partial unique indexes (`WHERE deleted_at IS NULL`).
   Migration `0003` backfills any non-conforming enum values before adding the free-text `applies_to`
   / `off_hours_policy` columns' CHECK constraints, so it is safe against pre-existing data.
   Regression: `tests/integration/test_soft_delete_uniqueness.py`.
9. **Lifespan startup wasn't exception-safe.** If any step after acquiring the DB engine failed (e.g.
   Redis unreachable), earlier resources (the engine) were never disposed. Rewrote with
   `AsyncExitStack` so every acquired resource is released regardless of where startup fails.
10. **`docker-compose.yml` never ran migrations** and the `worker` service was missing entirely (it was
    only added to docs, not compose) after Phase 4. Added a one-shot `migrate` service that runs
    `alembic upgrade head` before `api`/`worker` start, added the `worker` service, and added an API
    healthcheck.
11. Verified independently: `alembic check` after building the schema from models vs. from migrations
    on a scratch database — zero diff in constraints or indexes. Confirmed with a real `uvicorn`
    process (not just the ASGI test transport) that `/health`, `/ready`, security headers and 401s work
    end-to-end.

Net: went from "tests pass" to "tests pass and independently verified against running processes",
with 45 new regression tests (53 -> 98) — one for every defect above, each checked to fail on the
prior code.

## Webhook receiver and event queue (Phase 7-8)

- **Verification (`GET /api/v1/instagram/webhooks`):** Meta's one-time handshake when the
  subscription is configured. Returns `hub.challenge` only if `hub.mode=subscribe` and
  `hub.verify_token` matches `META_WEBHOOK_VERIFY_TOKEN` (constant-time compare); otherwise 403.
- **Delivery (`POST /api/v1/instagram/webhooks`):** fails closed (503) if the app secret or verify
  token is unset. Verifies `X-Hub-Signature-256` (HMAC-SHA256 of the *raw* body with the app secret,
  constant-time compare) before touching the JSON. Body capped at 2 MB. A malformed payload is 400;
  an invalid signature is 403; neither is ever parsed as JSON first.
- **Idempotency:** each entry is flattened into one or more `ParsedItem`s (`message:{mid}`,
  `{field}:{id}`) and inserted with `ON CONFLICT (external_event_id) DO NOTHING` — a duplicate Meta
  delivery (or a duplicate item within one delivery) is silently a no-op, never a duplicate reply
  later.
- **Fast return:** the route only verifies, resolves the Instagram account (if known) to its
  organization, persists, and calls `JobQueue.enqueue` onto the `events` queue. No AI call and no
  outbound Instagram call happen on this path, ever. An event for an unrecognized `external_account_id`
  is still stored (`organization_id`/`instagram_account_id` null) rather than dropped, so it's visible
  for investigation instead of silently lost.
- **Processing (`app/workers/queue.py::_process_webhook_event`):** an `events`-queue job (wrapped in
  the Phase 4 `tracked()` — inherits retry/backoff, DONE-skip idempotency) loads the `WebhookEvent` and
  calls `app/services/events/dispatch.py::dispatch`, a registry keyed by `event_type`. Comment and DM
  business logic (Phases 9, 13, 14) register handlers here; an unrecognized type is logged and skipped,
  never raises.
- Verified against a real running server: valid handshake, wrong token, unsigned POST, tampered body,
  and a correctly HMAC-signed POST — all behave as specified.

## Conversations and messages (Phase 9)

- **Resolution services** (`app/services/conversations/`): `get_or_create_customer` and
  `get_or_create_conversation` are race-safe upserts (`INSERT ... ON CONFLICT DO NOTHING` against the
  Phase-debug partial unique indexes) so two concurrent webhook deliveries for a brand-new customer
  never collide. `record_message` does the same keyed on `external_message_id` when one exists (inbound
  messages/comments); a human's manual reply has no external id yet, so it is always inserted.
- **Event handlers** (`app/services/events/handlers.py`, registered into the Phase 7-8 dispatch
  registry): `handle_message` and `handle_comment` turn a persisted `WebhookEvent` into
  customer + conversation + inbound message rows.
  - **Loop protection:** if the event's sender/comment author is the connected account's own external
    id, it is a self-echo (something we sent, delivered back through the webhook) and is skipped —
    never recorded as a second inbound message.
  - **Ordering:** a Redis lock keyed by `(instagram_account_id, external_user_id)` serializes all
    processing for one customer, so messages that arrive close together are recorded in arrival order
    even if their jobs run on different workers concurrently.
- **`EventContext`** (`dispatch.py`) carries both the DB session and a Redis handle explicitly into
  handlers, rather than smuggling Redis through session state.
- **Conversation state machine:** `AI_ACTIVE -> HUMAN_REQUIRED -> HUMAN_ACTIVE -> RESOLVED`
  (`app/services/conversations/conversations.py`). `request_human_handoff` is idempotent (a second
  trigger on an already-human conversation is a no-op) and records a `human_handoffs` row. STAFF can
  only see/act on conversations `assigned_user_id` points to them; a conversation outside their
  assignment (or in another tenant) returns 404, not 403, so its existence isn't leaked.
- **Human reply delivery:** `POST /conversations/{id}/messages` only works while the AI is silenced
  (prevents a human and the AI racing to answer the same conversation), inserts the outbound Message as
  PENDING immediately (visible in the inbox right away), and enqueues `send_instagram_message` on the
  `instagram` queue — the actual Graph API call never happens inside the HTTP request. That handler
  decrypts the account's token, checks `FEATURE_DM_REPLY` (suppresses without calling Instagram if the
  capability is off), and classifies `InstagramApiError` exactly as Phase 6 does: retryable errors defer
  via `RetryableJobError`, token errors flag the account `token_expired`, other errors mark the message
  FAILED without retrying.
- Verified against real running processes (uvicorn + a live `arq` worker on the `events` queue) with a
  genuine HMAC-signed webhook POST: comment -> webhook_events row DONE -> customer/conversation/message
  rows created, exactly as the unit tests assert. This caught a real bug the unit tests had missed (see
  below).
- Mutation-tested: loop protection, the human-takeover gate on manual replies, and STAFF conversation
  scoping were each independently broken and confirmed to fail their respective tests.

### Bug found only by running the real worker

The EVENTS-queue handler was named `_process_webhook_event` (leading underscore) but jobs were enqueued
under the string `"process_webhook_event"`. Every test called the wrapped handler directly
(`tracked(process_webhook_event)(ctx, job_id)`), which works regardless of the function's name — so
every test passed while the actual arq worker, which matches jobs to registered functions *by name*,
would have logged `function 'process_webhook_event' not found` forever and silently never processed a
single webhook event in production. Renamed to `process_webhook_event` to match; both queues'
registered function names are now asserted to match their enqueue strings as part of this verification.
This is the reason every phase in this project is checked against a real running server and worker, not
just the test suite.
