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

## Data retention on Instagram disconnect

Removed immediately: access token, token expiry, webhook subscription flag. Retained until the owner deletes
them: customers, conversations, messages, comments (so history survives reconnecting). Account and data deletion
tooling lands with the privacy phase; until then deletion is a manual operator action.
