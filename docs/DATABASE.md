# Database

PostgreSQL is the source of truth. Models live in `backend/app/models/`, migrations in
`backend/migrations/versions/`.

## Conventions

- UUID primary keys, `created_at`/`updated_at` (timestamptz), `deleted_at` for soft deletion where
  user data may need restoring or delayed purge.
- Enums are stored as validated `VARCHAR` with CHECK constraints (not native PG enums), so adding a
  value is an ordinary migration.
- Constraint and index names follow a fixed naming convention (`app/models/base.py`) so migrations
  are deterministic.
- Tenant-owned tables inherit `TenantOwned` (`organization_id`, FK to `organizations`, indexed).
  Repositories must always filter by `organization_id` resolved server-side.

## Tables

| Group | Tables |
|---|---|
| Identity | `users`, `organizations`, `organization_members` |
| Instagram | `instagram_accounts`, `customers`, `conversations`, `messages`, `comments`, `webhook_events` |
| Business | `business_profiles`, `ai_settings`, `knowledge_documents`, `knowledge_entries`, `automation_rules` |
| Operations | `ai_usage`, `jobs`, `human_handoffs`, `audit_logs` |
| Billing | `plans`, `plan_limits`, `subscriptions`, `usage_limits`, `usage_records` |

## Idempotency constraints

- `webhook_events.external_event_id` is unique.
- `messages (instagram_account_id, external_message_id)` and
  `comments (instagram_account_id, external_comment_id)` are unique.
- One `conversations` row per `(instagram_account_id, customer_id)`.

## Notes

- `instagram_accounts.access_token_encrypted` holds Fernet ciphertext; plaintext tokens are never stored.
- `knowledge_entries.search_vector` is a generated `tsvector` with a GIN index (full-text retrieval
  now; vector search can be added later without changing callers).
- `audit_logs` has no foreign keys on purpose: rows outlive deleted users and organizations.
- Plan limits are data (`plan_limits`, per-org `usage_limits`), never hard-coded.
