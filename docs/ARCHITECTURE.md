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
