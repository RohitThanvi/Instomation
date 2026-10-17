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

## AI gateway (Phase 10)

- **Provider abstraction** (`app/services/ai/provider.py`): the `AIProvider` protocol is the only
  thing business code depends on. `OpenAICompatibleProvider` implements it once for any
  OpenAI-style `/chat/completions` API; `GroqProvider` and `OpenAIProvider` just supply the base URL,
  key and default model. Adding a new provider (or a self-hosted one) never touches the gateway.
- **`AIGateway.complete`** (`app/services/ai/gateway.py`) is the single entry point. Per attempt:
  circuit breaker check -> layered rate limit (provider-wide, then per-tenant) -> timeout -> call. A
  retryable failure (`AIProviderError.is_retryable`: timeout, 5xx, 429) is retried with the Phase-4
  `RetryPolicy` (exponential backoff + jitter, honoring a provider's `Retry-After`); a non-retryable
  one (4xx other than 429) fails immediately without burning the retry budget. Once the primary
  provider's attempts are exhausted, the gateway falls through to the configured fallback provider
  once — never rotates API keys to dodge a rate limit.
- **Two independent rate-limit layers**, both backed by the Phase-4 `RateLimiter`:
  `AI_RATE_LIMIT_PER_MINUTE` (shared across every tenant — protects the account-wide capacity Groq or
  OpenAI actually grants) and `AI_RATE_LIMIT_PER_MINUTE_PER_TENANT` (keeps one organization from
  starving every other tenant of that shared capacity). They are genuinely separate settings/counters,
  not the same number applied twice.
- **Circuit breaker** (`app/services/ai/circuit_breaker.py`): Redis-backed, atomic via a single Lua
  script. After `AI_CIRCUIT_FAILURE_THRESHOLD` consecutive failures a provider is skipped entirely
  (no call made at all) for `AI_CIRCUIT_COOLDOWN_SECONDS`; one success resets the count.
- **Cost tracking** (`app/services/ai/pricing.py`, `usage.py`): every successful completion can be
  recorded to `ai_usage` with provider, model, token counts, latency and an estimated cost from a
  per-1K-token price table. An unpriced (provider, model) pair costs 0 rather than raising, so usage
  is never lost over a pricing-table gap.
- Wired into both the API process and every worker process (`app/main.py`, `app/workers/settings.py`),
  each with its own `AIGateway` instance sharing the process's Redis connection.

### Bugs found and fixed during this phase's own verification

Caught by the gateway's integration tests themselves (mutation-tested, not just "tests pass"):
1. An editing mistake left the per-tenant rate-limit rule using the *provider-wide* limit setting
   instead of the per-tenant one — the two layers were not actually independent as designed, which a
   genuine cross-tenant isolation test caught immediately.
2. A prior phase's blind find-and-replace (renaming `_process_webhook_event`, see the Phase 9 entry
   above) had also silently mangled a *test function's name* (`test_process_webhook_event...` became
   `testprocess_webhook_event...`, since the old name is a substring of the new one), which hid that
   test from pytest's collection entirely — a passing suite was quietly missing a test. Both are why
   this project greps for suspicious naming after any blind rename and re-counts the test total after
   every phase, not just reads "all tests pass".

## Moderation (Phase 11)

Every inbound message the AI might answer is safety-classified **before** any reply is generated.
Categories: `clean`, `spam`, `sexual`, `offensive`, `threat`.

- **Trigger** (`app/services/events/handlers.py::_defer_moderation`): after `handle_message` /
  `handle_comment` records a *new* inbound message, a `moderate_message` job is added to the `ai`
  queue. Skipped for: a redelivered message (nothing new recorded), a conversation a human owns, and
  organizations whose `ai_settings` has that automation (`dm_automation_enabled` /
  `comment_automation_enabled`) off or unset, so no model quota is spent where the AI will not reply.
- **Transactional deferral** (`EventContext.defer_job`): the `jobs` row is written in the *same
  transaction* as the message; `process_webhook_event` pushes it to Redis only **after** commit. A job
  therefore can never run before its message exists, and a Redis outage leaves a PENDING row for the
  existing `requeue_stale_jobs` sweeper.
- **Pipeline** (`app/services/moderation/service.py`): deterministic rules first
  (`rules.py`: more than `MODERATION_MAX_LINKS` links or `MODERATION_MAX_MENTIONS` mentions is spam
  with no model call; input over `MODERATION_MAX_INPUT_CHARS` is *not truncated* - truncation would let
  padding push a threat past the cut - and is escalated unclassified). Otherwise the
  `ModerationClassifier` asks the AI gateway (temperature 0) for `{"category", "confidence"}`.
- **Policy** (`policy.py`) fails closed: the **only** path to `allow` is a confident `clean`.
  `threat` escalates at *any* confidence (a false alarm costs a glance; a miss is the failure being
  prevented) and opens a `THREAT` handoff (conversation -> `human_required`, priority high).
  `spam`/`sexual`/`offensive` above `MODERATION_MIN_CONFIDENCE` are `block` (no reply, no human needed;
  message `intent` is set). Low confidence, unparseable or off-schema model output, and oversized input
  are `escalate` with `LOW_CONFIDENCE`.
- **Persisted contract:** `messages.moderation = {action, category, source, confidence}`, where `source`
  is `rules`, `model` or `fail_safe`. **Phases 13-14 must generate a reply only for a message whose
  `moderation.action == "allow"`;** a missing value means "not yet moderated", never "safe". The message
  text itself is not copied into this record.
- **Provider outage:** `AIGatewayError` becomes `RetryableJobError`, honoring the longest
  `retry_after` any provider reported (gateway now carries it). The message stays unmoderated, and so
  unanswerable, until a retry succeeds or the job is FAILED and visible to admins. Verified against
  running processes: an unreachable model tripped the circuit breaker and jobs were deferred ~60s.
- **Prompt-injection defense** (engineering rule 8): the message is passed only as a `json.dumps`
  string literal (no raw newlines or quote break-out), the system prompt declares it untrusted data,
  and output is validated against a closed schema, so injected text can at worst *choose* a category,
  never emit free text. An injection that convinces the model to say `clean` is a residual risk of any
  LLM classifier; the rules layer and the live test set below are the mitigations, not a guarantee.
- **Usage:** each classification is recorded in `ai_usage` with `purpose="moderation"`.
- **Also in this phase:** `GROQ_BASE_URL` / `OPENAI_BASE_URL` settings (self-hosted or proxy
  endpoints, and what makes the running-process verification possible), one shared
  `build_ai_gateway` for the API and workers, `AIGatewayError.retry_after`, and
  `META_WEBHOOK_VERIFY_TOKEN` defaulted in `tests/conftest.py` (five webhook tests only passed when
  that variable happened to be exported in the developer's shell).

### Verification status

Verified: 190 tests against real PostgreSQL + Redis from a clean migrated DB, `ruff`, `mypy --strict`;
14 targeted mutations of the safety logic (each caught by a test; one initially survived, exposing a
missing "flag explicitly off" test, now added); and an end-to-end run of real `uvicorn` + `arq`
(`events` and `ai`) processes with genuinely HMAC-signed webhooks (clean -> allow, threat -> escalate +
handoff, spam -> block, link flood -> rules without a model call, redelivery -> no second job).
**Not yet verified:** classification quality against the real Groq model. The development sandbox
could not reach the provider, so the model endpoint was a local stub. Run
`GROQ_API_KEY=... TEST_REDIS_URL=... pytest tests/test_moderation_live.py -v` to check it.

## Knowledge base (Phase 12)

Per-organization facts the assistant may answer from: `knowledge_entries` (`kind` faq / product / service /
policy / website / custom, `title`, `content`, flat `attributes`). Managed through `/api/v1/knowledge/*`
(`app/api/v1/knowledge.py`), which requires `SETTINGS_MANAGE` (owner, admin).

- **Tenancy and lifecycle:** every query filters by the server-resolved `organization_id` and
  `deleted_at IS NULL`; cross-tenant ids are 404, never 403, so existence is not disclosed. Delete is soft.
  Create/update/delete write `audit_logs` rows containing only `entry_id` and `kind`, never content.
- **Entry cap:** `KNOWLEDGE_MAX_ENTRIES` (default 500) active entries per organization, enforced in
  `create_entry` under a transaction-scoped Postgres advisory lock keyed on the organization, because a plain
  count-then-insert lets concurrent requests jointly exceed the cap (verified: with a shared instead of an
  exclusive lock the concurrency test fails). Plan-based limits (Phases 17-18) will supersede this setting.
- **Retrieval** (`services/knowledge/search.py::search_entries`, also exposed as `POST /knowledge/search`):
  the query text is reduced to distinct lower-cased words of at least `KNOWLEDGE_SEARCH_MIN_TERM_LENGTH`
  characters (at most `KNOWLEDGE_SEARCH_MAX_TERMS`), joined with `|`, and run through `to_tsquery('simple', ...)`
  against the generated `search_vector` (GIN index), ranked by `ts_rank_cd`. Words are OR-ed because a customer's
  question rarely contains every word of the right entry. **Only sanitized word tokens reach `to_tsquery`**:
  customer text can never inject tsquery operators or raise a syntax error (tested with hostile input, and with
  the sanitizer mutated away). Tokenization checks Unicode categories (letters, combining marks, digits) instead
  of `\w`, which omits the marks Indic scripts use and would split "डिलीवरी" into fragments (caught by the Hindi test).
- **Known limits:** lexical only. The `simple` configuration does no stemming or synonyms, so "shipping" does not
  match "ships", and a question phrased with none of an entry's words finds nothing. Vector search can replace
  `search_entries` behind the same signature. Non-ASCII matching depends on the database using a UTF-8 encoding
  with a non-`C` ctype (`C.UTF-8` or `en_US.UTF-8`; verified on `C.UTF-8`), so check this on the managed provider.
- **For Phases 13-14 (rule 8):** retrieved `title`, `content` and `attributes` are untrusted data, not
  instructions. Render them into the prompt as escaped data inside a delimited block, cap the total size, and never
  let an entry change the system prompt, even though only admins write them (a compromised admin account, or
  later imported website text, is exactly the case this defends).
- **Not in this phase:** website crawling and file upload (`knowledge_documents` is unused until then). Fetching
  user-supplied URLs is an SSRF surface (private ranges, redirects, DNS rebinding) and needs its own design.

### Verification status

190 -> 253 passing tests plus 8 live skipped (real PostgreSQL + Redis, clean migrated DB), `ruff`, `mypy --strict`;
20 targeted mutations of the tenancy, soft-delete, cap, lock, RBAC, sanitizer, ranking and tokenizer logic, all
caught (the advisory-lock mutant was re-run in a form that compiles, 3/3 caught by the concurrency test); and a
run against a real `uvicorn` with RS256 JWTs verified against a locally served JWKS: CRUD, English and Hindi
retrieval, manager 403, cross-tenant 404/403, hostile search text 200, and unknown-`kid`, expired and
wrong-issuer tokens all 401. Not verified: behavior on a managed PostgreSQL provider (collation, see above).

## DM auto-reply (Phase 13)

`moderate_message` (Phase 11) chains to `generate_dm_reply` **only** for a DM whose verdict is `allow`
(`payload.channel == "dm"`; comments stop there until Phase 14). The follow-up job is written in the same
transaction as the verdict (`app/workers/jobs.py::add_job`) and pushed to Redis after commit; the sweeper covers a
failed push. `app/services/automation/dm_reply.py` then either queues one reply or decides not to.

- **Reasons not to answer** (`_skip_reason`, evaluated before the model call **and again under a conversation row
  lock right before the reply is recorded**, because the model call takes seconds): message not moderated
  `allow` (`NOT_CLEARED`), `dm_automation_enabled` off, conversation not AI-active, message older than
  `DM_REPLY_WINDOW_HOURS`, a human or AI reply already exists after it, a newer answerable customer message exists
  (a burst gets one reply to the latest, with the whole exchange as context; a newer message that was blocked or
  escalated does not take the reply), and `max_replies_per_conversation_per_hour` reached (loop protection).
- **Prompt** (`prompt.py`): fixed rules, then business profile and the top `DM_REPLY_KNOWLEDGE_ENTRIES` knowledge
  hits as a single `json.dumps` block, so stored text cannot pose as instructions (rule 8). Retrieval query is the
  last two customer messages so a keyword-less follow-up still finds its entry. Entries that do not fit
  `DM_REPLY_KNOWLEDGE_MAX_CHARS` are skipped whole. History is the last `DM_REPLY_HISTORY_MESSAGES` turns, excluding
  internal notes and messages moderation blocked or escalated.
- **Fail closed:** the model must return `{reply, confidence, needs_human}` (strict schema). A human is asked
  instead of anything being sent when: output is unparseable (`LOW_CONFIDENCE`), `needs_human` (`MISSING_INFORMATION`),
  confidence is below the organization's `confidence_threshold`, the reply is empty, exceeds `DM_REPLY_MAX_BYTES`
  in UTF-8 (never truncated), or **contains a link that does not appear in the business's own profile/knowledge**
  (so a customer who talks the model into a phishing link gets nothing sent under the business's name).
- **Sending:** the reply is an outbound `origin=ai`, `status=pending` message plus a `send_instagram_message` job
  (same transaction, push after commit), i.e. the Phase 9 delivery path unchanged. Usage is recorded with
  `purpose="dm_reply"`, including when the answer is discarded or escalated.
- **Provider outage:** `AIGatewayError` -> retry honoring `retry_after`; nothing is sent or escalated meanwhile.

### Known gaps (Phase 13)

- **`off_hours_policy` / `working_hours` are not honored** (their format is not defined anywhere yet); the assistant
  behaves as `respond`. Per-organization `provider` / `model` overrides in `ai_settings` are also not used yet.
- **Delivery to Meta is unverified.** The smoke test reached the real send job, which made the Graph request; the
  development sandbox's egress blocks `graph.instagram.com` (403), so a successful send was never observed. Needs a
  run with a real connected account.
- Reply quality against the real model is unverified (the model was a local stub); the live-provider test for
  moderation is still pending too.

### Verification status

302 tests + 8 live skipped (before the 13b additions below) on real PostgreSQL + Redis from a clean migrated DB, `ruff`, `mypy --strict`; 29
mutations of the gating, fail-closed, history, retrieval, prompt-escaping, link-guard and chaining logic, all caught
(one survived at first: the history filter was shadowed by a time filter in the existing test, so a test with
*earlier* spam was added; the row lock itself is not mutation-tested, as a lock-ordering race cannot be reproduced
deterministically, but the re-check it protects is, via a takeover during the model call). End to end against real
`uvicorn` + `arq` workers (events, ai, instagram) with signed webhooks: grounded reply queued and picked up by the
send worker, threat -> handoff with no reply call, injected phishing link -> handoff, unknown question -> handoff,
spam -> no reply call, Meta redelivery -> no duplicate (5 classifications, 3 reply calls, 0 tracebacks).

## Settings API and giving up gracefully (Phase 13b)

**Settings API** (`app/api/v1/business.py`, `services/business.py`, owner/admin only via `SETTINGS_MANAGE`):
`GET|PUT /business/profile` and `GET|PATCH /settings/ai`. Only fields the pipeline actually honors are exposed
(`working_hours`, `off_hours_policy`, `timezone`, per-org `provider`/`model` and `comment_like_enabled` are not, so the
UI cannot offer a control that does nothing; unknown fields are 422). `PUT` replaces the whole profile (a field left
out is cleared). `PATCH` is partial (`false` and `0` are real values; an empty body is 422). `GET` never writes a
row: an organization that never saved sees the effective defaults. The first save is insert-or-skip on the unique
`organization_id`, so simultaneous first saves cannot fail or duplicate. Size limits exist because these fields are
rendered into the model's prompt. `website` must be http(s) because it also feeds the reply link allowlist. Changes are
audited as field names (profile) or flag/number values (AI settings); text is never written to the audit log;
no-op saves are not logged.

**Giving up** (`services/automation/escalation.py`, `tracked(..., on_exhausted=...)`): when automation can no longer
serve a customer, a human is asked instead of nothing happening.
- A send that fails permanently (inactive account, expired or undecryptable token, non-retryable Meta error) or
  exhausts its retries marks the message `failed`; if the AI wrote it, a `manual` handoff is opened (idempotent: nothing
  happens if a human already owns the conversation; human-written messages do not raise one).
- Moderation or reply jobs that exhaust their retries (provider down) open a `low_confidence` handoff.
- Found in a real-process run: a send that exhausted retries previously left the message `pending` forever and the
  customer unanswered. The handoff reason is `manual` because adding a dedicated `delivery_failed` value needs a
  migration of the enum's CHECK constraint; do that if the inbox should distinguish it.

Verified: 14 mutations of the settings logic and 12 of the escalation logic, all caught (four initially escaped
because the tests did not cover them: profile `GET` writing a row, unknown fields alongside valid ones, an unapplied
audit mutant and the undecryptable-token path; tests were added). Real `uvicorn` + workers with signed JWTs:
the owner configured profile, knowledge entry and DM automation purely through the API, a DM sent before that was
ignored (no model call), one sent after was moderated and answered from the configured knowledge, a manager got 403,
and with Meta unreachable the exhausted send ended `failed` with the conversation `human_required`.

## Comment auto-reply (Phase 14)

Same shape as DM replies, for **public** replies to comments (`app/services/automation/comment_reply.py`). The comment
event handler (Phase 8) already stored each comment as an inbound message (`external_message_id` =
`comment:<instagram comment id>`, `COMMENT_ID_PREFIX`) and queued moderation; `moderate_message` now chains by channel
(`REPLY_FUNCTIONS`): a cleared DM goes to `generate_dm_reply`, a cleared comment to `generate_comment_reply`. Nothing
else is chained, so blocked, escalated and unmoderated comments are never answered.

- **Switch:** `ai_settings.comment_automation_enabled`, independent of `dm_automation_enabled`.
- **Skip reasons** (checked before the model call and again under the conversation lock): not a comment, not
  moderated `allow`, automation off, conversation owned by a person, comment older than `COMMENT_REPLY_WINDOW_HOURS`
  (72), already answered, and the hourly AI-reply cap. "Already answered" is read from the send job
  (`payload.comment_message_id`), not from message order, because comments on different posts interleave in one
  conversation. There is no "superseded" rule: each comment is independent.
- **Prompt:** the shared rules plus a public-channel clause (never personal, order-specific or private details; if the
  commenter needs those, `needs_human`); only the comment text is sent as the user turn (no history); knowledge
  retrieved with the comment as the query. Same escaped-data, grounding and link-allowlist defenses as DMs.
- **Fail closed:** same gates as DMs, with the length limit counted in **characters** (`COMMENT_REPLY_MAX_CHARS`, 300,
  inclusive; a Hindi reply of 300 characters is fine) and escalated rather than truncated.
- **Delivery:** outbound `origin=ai` message + `send_comment_reply` job (same transaction, push after commit) that
  calls `reply_to_comment`; it shares `_deliver` with the DM send, so it has the same capability flag
  (`FEATURE_COMMENT_REPLY`), token handling, retry behavior and give-up escalation.
- **Private reply (opt-in, migration `0005`).** `ai_settings.private_reply_enabled` (default off) plus the
  `FEATURE_PRIVATE_REPLY` capability. When both are on, the one model call for a comment may also return
  `private_reply`: details too long or specific for a public comment. The prompt (`private_max_chars`, a quarter of
  `DM_REPLY_MAX_BYTES`) tells the model the private message is the only one the commenter will receive until they
  answer, and that the public reply is then a brief acknowledgement. The private text is held to every DM check
  (confidence, links only from the business's data, at most `DM_REPLY_MAX_BYTES` bytes); if the public reply or the
  private text fails any, **neither is sent** and a person is asked, because the public reply promises a message. An
  empty `private_reply` means public reply only. A private text the model writes while the feature is off is ignored.
  Both texts become outbound `origin=ai` messages and two send jobs (`send_comment_reply`, `send_private_reply`) in
  one transaction; "already answered" is still read from the public job, so a duplicate job sends neither again. Both
  count toward the hourly AI-reply cap. `send_private_reply` shares `_deliver` and calls
  `POST /{ig-id}/messages` with `recipient.comment_id`; if Meta refuses (comment older than 7 days, already
  privately answered, a Live broadcast that ended) the message is `failed` and a person is asked to follow up. Meta's
  rules, from its documentation: one message per commenter until they respond, within 7 days of the comment (during
  the broadcast for Live), follow-ups only within 24 hours of their reply. `COMMENT_REPLY_WINDOW_HOURS` is therefore
  capped at 168.
- **Channel separation:** the DM generator refuses comment messages (a requeued or forged job must not DM someone who
  only commented publicly) and vice versa; both are tested.
- Refactor in this phase: knowledge retrieval, answer gating (`escalation_reason`) and the prompt rules are shared
  between the two channels instead of copied; the send handler became `_deliver`. A latent order-dependent query in an
  existing test (an unfiltered `select(Job)`) was scoped to its organization.

### Known gaps (Phase 14)

- **Private replies are unverified against Meta** (sandbox egress is blocked): the request the client builds was
  checked against Meta's documented shape, and everything around it was tested with a fake, but no real private reply
  has been sent. Whether the model reliably uses `private_reply` well is also unchecked against the live provider.
- **Handoff is not configurable and has no explicit "asks for a person" or "complaint" detector.** A conversation goes
  to a person when moderation sees a threat or is unsure, when a reply's confidence is below `confidence_threshold`
  (the one tunable), or when the model sets `needs_human`. The prompt tells the model to do that for missing
  information, refunds, complaints, legal matters, custom quotes and order or booking changes, so those depend on
  model judgment, which has not been checked against the live provider. There is no per-organization switch for any
  of it; the onboarding screen states this instead of offering toggles.
- Instagram offers no endpoint to like or hide via this API, so neither is attempted (`comment_like_enabled` is not
  exposed).
- Delivery to Meta is unverified for the same reason as DMs (sandbox egress); reply quality against the real model is
  unverified.

### Message channel (migration `0006`)

`messages.channel` (`dm`, `comment`, `private_reply`, `NULL` for internal notes) marks where each message lives, so the
inbox can tell a customer's public comment, our public reply and our private reply apart; before it, one comment with
private replies on showed two unlabeled AI messages. `record_message` takes `channel` as a required argument (no
default), so a new writer cannot forget it; the inbound webhook handlers, DM reply, comment reply, private reply, human
reply and internal note each pass theirs, and `MessageOut` exposes it. The migration backfills from the `comment:`
external id and from the send jobs; an AI comment reply whose job was already purged cannot be recognised and reads as
`dm` (see `docs/DATABASE.md`). Tested on real PostgreSQL: the backfill (every row kind, from a database stepped back to
`0005`) and each writer's channel through the real handlers and API; every SQL rule and writer was mutated and caught
(one backfill predicate was redundant, not untested, and was removed). The frontend parses a real response with its
zod schema and shows the caption in the thread.

### Verification status

397 tests + 8 live skipped on real PostgreSQL + Redis, `ruff`, `mypy --strict`; 19 mutations of the comment gates, length
semantics, channel separation, chaining, capability flag and send call, all caught. One initially survived because
`tracked()` already skips a re-run of a finished job row, so the "re-run" test never reached the already-answered
check; tests now create a *duplicate job row* (for DMs as well) and the mutants die. Real `uvicorn` + workers with signed
`comments` webhooks and only comment automation enabled: a DM was ignored (no model call), a delivery question was
answered from the knowledge base, a threat escalated, a link flood was blocked by rules with no model call, a phishing-link
attempt went to a human, a redelivered comment created nothing, and with Meta unreachable the send exhausted its retries
and ended `failed` with a handoff.

## Human takeover (Phase 15)

Takeover, hand-back and resolve existed since Phase 9, but the `human_handoffs` rows that automation opens (threats,
low confidence, failed sends, exhausted AI jobs) were never advanced: they stayed `open` forever, and there was no queue
of conversations needing a person. Phase 15 closes that loop.

- **Lifecycle** (`services/conversations/conversations.py::_advance_handoffs`): `take_over` moves the conversation's
  `open` handoffs to `assigned` (to the person who took over); `hand_back_to_ai` and `resolve` move `open` and `assigned`
  ones to `resolved` with `resolved_at`. Only that conversation's rows change; a resolved handoff is never
  re-assigned; taking over a conversation nobody flagged is fine (no handoff row to move). A conversation that needs a
  person again after hand-back gets a fresh `open` row; history is kept.
- **Concurrency:** `request_human_handoff` now locks and re-reads the conversation row before deciding, because two
  automation steps can ask at once (a threat verdict and a failed reply). Without it each saw "AI active" and opened
  its own handoff. Verified with a deterministic test (hold the row, start three requests, release: exactly one
  handoff and one audit entry); the mutant without the lock dies 3 of 3 runs. An earlier 10-way `gather` test passed
  even without the lock, which is why it was replaced as the proof.
- **Queue** (`app/api/v1/handoffs.py`): `GET /handoffs` (keyset, oldest first, unresolved by default, `status` filter)
  and `GET /handoffs/counts`. Scoped by tenant, by soft-deleted conversations, and by role: staff see only conversations
  assigned to them (same rule as the conversation list).
- **Not included:** automatic release of a takeover left idle (a product decision: how long, and what the customer
  experiences meanwhile), notifications (email/push), assignment to someone other than yourself, and a dedicated
  `delivery_failed` handoff reason (needs an enum CHECK migration).

### Verification status

Handoff tests: lifecycle through the real API, queue ordering/filter/pagination/counts, staff and tenant scoping,
soft-deleted conversations, and the lock. 14 mutations of the lifecycle, scoping and lock: 13 caught, 1 equivalent
(`counts` reads only the `open` and `assigned` keys of its grouped result, so dropping its `WHERE` clause cannot change
the response; the clause stays as an efficiency measure). Three mutants initially escaped for want of a test (re-assigning
a resolved handoff, a soft-deleted conversation's handoff, and the lock) and tests were added.

## Analytics and usage API (Phases 16-17)

Read-only aggregates for the dashboard (`app/api/v1/analytics.py`, `services/analytics.py`). The dashboard's analytics
section (Phase 18, `frontend/src/features/dashboard`) now consumes `GET /analytics/overview` for the last 7, 30 or 90 UTC
days. Two response details the UI depends on: `conversations.by_state` is the present, not the period, and
`daily.outbound` / `messages.outbound_ai` count every outbound message including failed deliveries, while
`automation.ai_replies_sent` counts only sent ones. `handoffs_by_reason` is zero-filled and includes `manual`.
Onboarding activation (`frontend/src/api/business.ts`) saves through `PUT /business/profile`, the knowledge entry
endpoints and `PATCH /settings/ai`; the exact request bodies it builds were replayed against the real API on
PostgreSQL (all 200/201) and the real responses parsed with the frontend schemas. The other Phase 18 screens are not
built yet except the knowledge base (`frontend/src/features/knowledge`), whose requests (kind filter, cursor paging, partial PATCH, DELETE
answering 204, search) were replayed against the real API on PostgreSQL and their responses parsed with the frontend
schemas. Real behaviors it relies on: lists are oldest first, a repeat DELETE is 404, a blank title is 422, and
retrieval matches whole words only.

- `GET /analytics/overview` (`ANALYTICS_VIEW`: owner, admin, manager) and `GET /usage` (`SETTINGS_MANAGE`: owner, admin;
  costs are not for every member). Both take `from`/`to` (inclusive UTC dates; default last 30 days; at most 366;
  otherwise 422 `INVALID_RANGE`).
- **Day boundaries:** a range is `[from 00:00 UTC, to+1 00:00 UTC)`, so the end date is included to its last
  second; per-day buckets use `timezone('UTC', created_at)` so they do not depend on the database session's time zone.
  Series are zero-filled. Organizations have no timezone setting, so "a day" is a UTC day.
- **What is counted:** messages exclude internal notes; conversation `by_state` is a current snapshot (not limited to
  the range) and skips soft-deleted conversations; handoffs are bucketed by creation (opened) and by `resolved_at`
  (resolved) independently; moderation counts are customer messages by their stored verdict.
- **Cost honesty:** `estimated_cost` comes from `services/ai/pricing.py`; an unknown (provider, model) prices at zero by
  design so usage is never lost. The report therefore carries `unpriced_requests` (requests that used tokens but have no
  price) so a total is never silently understated.
- **Index:** migration `0004` adds `messages(organization_id, created_at)`, since these queries aggregate one
  organization's messages over a range.
- **Not included:** comparison against plan limits (no plans are seeded and billing is not built), CSV export, caching, and
  per-user or per-conversation breakdowns.

### Verification status

20 analytics tests on real PostgreSQL with exact expected numbers from seeded data at fixed timestamps: both range
boundaries (first instant in, last second in, the next instant out), the UTC-day bucket, zero-filled series, snapshot
versus range semantics, soft-deleted conversations, handoffs opened versus resolved, internal-note exclusion, role
gates, tenant isolation, range validation (including exactly 366 days) and decimal sums. 22 mutations, all caught
(one target initially matched twice and was re-run with context). Not mutation-tested: replacing `timezone('UTC', ...)`
with a plain cast behaves identically while the database session is already in UTC, as in the test database, so no test
can tell them apart; the choice is defensive. Real `uvicorn` + workers: after the comment scenario the live overview
matched the database exactly (5 inbound, 1 failed AI reply, 3 handoffs by reason, moderation 2 allowed / 1 blocked /
1 escalated, 5 usage rows split 3 moderation and 2 comment replies).


## Deployment (Phases 19-20)

- **Bug found and fixed:** `docker-compose.yml` ran a single worker with `WORKER_QUEUE=maintenance`. A worker consumes
  exactly the queue named by `WORKER_QUEUE`, so under compose nothing would have processed the `events`, `ai` or
  `instagram` queues: webhooks would be accepted and then never handled. (Smoke tests missed it because workers were
  started by hand.) Compose now has `worker-events`, `worker-ai`, `worker-instagram` and `worker-maintenance`; keep
  maintenance at one replica because it runs the cron sweepers.
- **Worker liveness:** arq's health key refreshed hourly by default, so a stuck worker looked healthy for up to an hour.
  `WORKER_HEALTH_CHECK_SECONDS` (default 30) sets the refresh; compose health checks run
  `arq app.workers.settings.WorkerSettings --check`. Verified against a real worker: healthy -> 0, frozen with SIGSTOP
  -> fails within about the interval, recovers when unfrozen.
- **`.env.example` drift fixed:** it told operators to set `CLERK_SECRET_KEY`, a backend `CLERK_PUBLISHABLE_KEY` and
  `SENTRY_DSN`, none of which the backend reads (tokens are verified through JWKS; there is no error-tracking
  integration), and it omitted 20 settings the code does read. Tests now require every setting to be documented and
  nothing unknown to be.
- **Guarded by `tests/test_deployment.py`** (structural, because Docker is not available in every environment): every
  queue has exactly one worker, workers are health-checked and wait for migrations and Redis, migrations run once
  before the API, no literal secrets in compose, the image is non-root. 8 regressions mutation-checked, all caught.
- **CI hardening:** `docs/ci/backend-ci.yml` now sets every required setting (the staged version omitted
  `META_REDIRECT_URI` and others, so `alembic` could not even start: verified by running it with that environment),
  runs `alembic upgrade head && alembic check` on an empty database, and runs the suite under the coverage gate.
  `docs/ci/frontend-ci.yml` runs lint, typecheck, format check, test and build. Every command was run locally first;
  `alembic check` was mutation-checked (an unmigrated column makes it exit non-zero, a clean tree exits 0). The
  workflows live in `docs/ci/` because the push token cannot write `.github/workflows/`, and they have not run on GitHub.
- **Coverage gate:** `[tool.coverage]` in `backend/pyproject.toml` sets `concurrency = ["greenlet", "thread"]`.
  Without it the total was 88% and knowledge `entries.py` 49%; with it 94% and 96%. After the registry test the total
  is 95.13%; `fail_under` is 94.
- **Handler registration:** `tests/test_worker_registry.py` pins the exact function names registered per queue in
  `HANDLERS` and the cron jobs, because arq matches enqueued jobs to handlers by name and an unmatched name is never
  run. Five mutants (dropped events handler, dropped comment send, dropped DM reply, dropped cron job, duplicated
  handler) were all caught. It cannot see the string literals at enqueue call sites; the end-to-end worker tests and the
  real-process run below cover those.
- **Real processes (no Docker):** against migrated PostgreSQL 16 and Redis, the API and one `arq` worker per queue
  were started as separate processes: `/health` and `/ready` returned 200 and every worker's `--check` exited 0. A
  genuinely HMAC-signed webhook returned 200 and was marked `done` by the events worker, a replay returned 200
  without a second row, and tampered, unsigned and wrong-verify-token requests returned 403. Idle memory was about
  97 MB for the API and 85 MB per worker. No bug was found in this run.
- **`docs/DEPLOYMENT.md`** documents process layout, environment, migrate-on-release, scaling rules, Meta webhook
  setup and the free-tier path, with its own verification status.
- **README:** the API table was missing 12 endpoints and is now generated from the OpenAPI document (35) plus the two
  Meta-facing routes hidden from it; the "migration 0001" mention now says head is 0004.
- **Not verified:** the compose stack and the images were never built or run (no Docker in the development sandbox);
  the CI workflows have not run on GitHub; delivery to Meta's Graph API; behaviour on managed PostgreSQL or Redis.
