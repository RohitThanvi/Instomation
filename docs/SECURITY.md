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

## Data retention on Instagram disconnect

Removed immediately: access token, token expiry, webhook subscription flag. Retained until the owner deletes
them: customers, conversations, messages, comments (so history survives reconnecting). Account and data deletion
tooling lands with the privacy phase; until then deletion is a manual operator action.
