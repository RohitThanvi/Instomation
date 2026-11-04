# Security

- **Authentication:** Clerk JWTs verified server-side (RS256, JWKS cache, issuer and `azp` checks).
- **Tenancy:** tenant is resolved from verified identity + membership, never trusted from the client
  (`X-Organization-ID` only selects among the caller's own memberships). All tenant queries filter by
  `organization_id`. Covered by integration tests.
- **Authorization:** role permissions in `app/core/rbac.py`; server is the authority.
- **Secrets:** environment variables only. Instagram tokens are encrypted at rest with Fernet
  (`TOKEN_ENCRYPTION_KEY`, rotation through `TOKEN_ENCRYPTION_PREVIOUS_KEYS`) and never returned by the API
  or logged. httpx/httpcore URL logging is muted because two Meta endpoints take tokens as query params.
- **OAuth:** single-use, expiring, user- and org-bound `state`; callback failures redirect with an error code only.
- **Errors:** consistent envelope; no stack traces or internals exposed.
- **Audit:** sensitive actions are written to `audit_logs` in the same transaction as the change.
- **Abuse and overload:** see "Abuse protection and overload" below.

## Abuse protection and overload

What is enforced, and where (all limits are environment settings, documented in `.env.example`):

- **Request size.** `MAX_REQUEST_BODY_BYTES` (2 MiB) is enforced before any body is buffered: a declared
  `Content-Length` is checked up front and a chunked or understated body is counted as it streams in, so an
  oversized request gets a 413 and never reaches authentication, the signature check or memory. This covers the Meta
  webhook, whose own after-the-fact check was removed in its favour.
- **Per-address flood guard.** `RATE_LIMIT_PER_MINUTE_PER_IP` (600) runs before authentication. Health probes and the
  signed Meta webhook are exempt (many accounts' events arrive from few addresses; the webhook has its signature gate).
- **Per-member limit.** `RATE_LIMIT_PER_MINUTE_PER_USER` (120) runs once the caller is authenticated, keyed by user
  id across all their tabs and devices, so a stolen or runaway client cannot hammer expensive endpoints (analytics,
  search, usage). A request that fails authentication does not use up a member's allowance. Both limits answer 429
  with `Retry-After`.
- **Client address.** The address used for the flood guard is the TCP peer unless `TRUSTED_PROXY_COUNT` says N proxies
  sit in front, in which case it is the Nth entry from the right of `X-Forwarded-For`. Entries to its left are
  client-supplied and ignored, a header shorter than the chain or holding a non-address is not trusted, and with 0
  the header is ignored entirely. Set the exact number: too high lets a client choose its own address.
- **Database.** A request waits at most `DB_POOL_TIMEOUT_SECONDS` (10) for a pooled connection, then gets a fast 503
  `SERVICE_BUSY` with `Retry-After` instead of queueing behind the rest. A query running longer than
  `DB_STATEMENT_TIMEOUT_MS` (15 s) is cancelled by PostgreSQL and the request gets the same 503. Workers are bounded by
  `JOB_TIMEOUT_SECONDS` instead. The limit is applied with a plain `SET` on each connection, not a startup parameter,
  so it does not depend on the pooler accepting unknown options.
- **Response headers.** Every response is `Cache-Control: no-store`, `nosniff`, `X-Frame-Options: DENY` and
  `Referrer-Policy: no-referrer`. In production it also carries `Content-Security-Policy: default-src 'none';
  frame-ancestors 'none'` and a two-year HSTS (`includeSubDomains`). Both are production-only because the development
  Swagger UI needs scripts; the API serves JSON, never a page.

Known limits (be honest about them when sizing):

- The limiter uses fixed windows, so a burst of up to twice the limit can pass across a window boundary.
- It fails open when Redis is unreachable (logged as `request_rate_limit_unavailable`): a cache outage must not take
  the whole API down, but protection pauses until Redis is back. `/ready` still reports Redis.
- Addresses are limited individually, so a client holding a whole IPv6 range can rotate addresses; the per-member limit
  still binds an authenticated caller. Unauthenticated floods at scale belong at the proxy or CDN as well.
- The webhook is exempt from the address guard, so forged deliveries cost one HMAC computation each before being
  refused; rate-limit it at the proxy if that matters to you.
- None of these defaults has been load-tested; they are conservative starting points. The per-member limit assumes the
  app's polling (inbox, thread, handoffs) from a handful of tabs.

## Automation rules

Rules send text their author wrote, so they carry no model risk, but they are an easy way to send the wrong thing
automatically, so they run behind every gate an AI reply passes and are applied under the conversation lock with the
gates checked again (see `docs/ARCHITECTURE.md`). They can never reply to a message moderation blocked, never answer a
conversation a person owns, and count toward the hourly reply cap, which also stops two automated senders from
answering each other in a loop. One that cannot be carried out in full (text now over a limit, a private message while
private replies are off) hands over instead of sending part of it. Managing them needs `automation_manage` (owners,
admins, managers; staff get 403), is scoped to the organization by every query, and is audited without the rule text.
A message written by a rule carries `automation_rule_id`, so the inbox can always say which rule sent it.

## Data retention on Instagram disconnect

Removed immediately: access token, token expiry, webhook subscription flag. Retained until the owner deletes
them: customers, conversations, messages, comments (so history survives reconnecting). The owner can disconnect an
account from Settings, Instagram. There is no self-serve deletion API: the public `/data-deletion` page tells people
to email the operator, who verifies the request and deletes the data within 30 days (`DELETION_DEADLINE_DAYS` in
`frontend/src/config/constants.ts`; the privacy policy repeats it, so change both together). Erasure is a manual
operator action. A runbook for it has not been written or tested: deleting the organization row is expected to
cascade through the tenant-owned tables (the foreign keys are `ON DELETE CASCADE`), but that has not been verified
against a real database.

## Review of 4 November 2026

A read-through of the security-relevant code plus automated scans, done before the first public deployment. It is
not a penetration test and no outside party has attacked the system.

**Checked in the code and found sound**

- Session tokens: RS256 only; issuer, `exp`, `iat`, `sub` required; the authorized-party check is mandatory in
  production (settings refuse to load without `CLERK_AUTHORIZED_PARTIES` and `CORS_ALLOWED_ORIGINS`); key refetches
  are rate-limited so forged key ids cannot hammer the identity provider.
- Webhooks: HMAC-SHA256 signature and the verify token are compared in constant time.
- OAuth `state` is single use (read-and-delete in Redis).
- No SQL built from strings was found; the ORM is used throughout. Outbound HTTP goes only to the configured AI
  providers and Meta, never to a URL a user supplies, so no server-side request forgery surface was found.
- `/docs` and the OpenAPI schema are off in production; the backend image runs as a non-root user.

**Scans**

- `pip-audit` on `backend/constraints.txt`: no known vulnerabilities. Bandit (medium and above): no findings.
- `npm audit --omit=dev`: `fast-uri` (via `ajv`) was fixed with a lockfile update. **`zod` 3.x is still flagged as
  high severity** (memory exhaustion when validating oversized constrained collections). The fix is zod 4, a major
  upgrade across every API schema, so it was not done here. The exposure is client-side: the browser validates
  responses from our own API. Plan the migration; do not ignore it.

**Fixed in this review**

- `docker-compose.yml` published PostgreSQL (default password) and Redis (no password) on every interface. All
  ports now bind to `127.0.0.1`, and `docker-compose.prod.yml` refuses a default database password. A test guards both.

**Known gaps (not fixed)**

- The request rate limiter **fails open** when Redis is unreachable (a deliberate availability choice, logged as
  `request_rate_limit_unavailable`). The limits themselves are conservative guesses, never measured under load.
- No protection against volumetric DDoS, no WAF; a single VM is a single point of failure.
- No Content-Security-Policy for the web app (it needs the Clerk domains); the API sets its own.
- Redis has no password; it is reachable only on the compose network and from the host's loopback.
- CI does not yet run secret scanning, image scanning or `pip-audit`/`npm audit`.
- No central log shipping or alerting; nobody is paged when a worker dies.
- Two-factor sign-in for workspace members is a Clerk setting that has not been checked.
- Host hardening (SSH keys only, patching, firewall) is the operator's job; see `docs/DEPLOYMENT_ORACLE.md`.
