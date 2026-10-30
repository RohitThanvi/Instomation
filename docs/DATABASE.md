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
- Non-ASCII full-text matching (e.g. Devanagari) needs a UTF-8 database with a non-`C` ctype such as `C.UTF-8` or
  `en_US.UTF-8`; verify it when choosing a managed PostgreSQL provider.
- `ai_settings.private_reply_enabled` (migration `0005`, `NOT NULL DEFAULT false`) lets an organization opt in to a
  private message to commenters; existing organizations are unchanged until they turn it on.
- `messages.channel` (migration `0006`, nullable, CHECK-constrained `dm` / `comment` / `private_reply`) records where a
  message lives on Instagram: a customer's comment and our public reply to it are `comment`, a DM to a commenter is
  `private_reply`, everything else is `dm`, and an internal note is `NULL` (it never leaves the app). Every writer of
  `record_message` must state it (the argument has no default). The migration backfilled existing rows: inbound comments
  from their `comment:` external id, AI replies from the send job that delivered them (`send_comment_reply`,
  `send_private_reply`). Jobs are purged after `JOB_RETENTION_DAYS`, so an AI comment reply older than that cannot be
  recognised and was backfilled as `dm`.
- `automation_rules` (migration `0007`) holds the IF/THEN rules that answer a message instead of the AI: `applies_to`
  (`dm` / `comment` / `both`), `keywords` (1 to 20, each up to 60 characters) with `keyword_match` (`any` / `all`),
  `action` (`reply` / `handoff` / `skip`), `reply_text`, `private_reply_text` (comment rules only), `handoff_reason`,
  `enabled`, `priority` (lowest is tried first) and soft delete. The table had existed since the first migration with
  nothing reading or writing it, and described unbuilt features (liking comments, notifying the owner, matching on a
  topical intent that nothing in the pipeline assigns to an allowed message); `0007` reshapes it. CHECK constraints
  hold what the API enforces (a reply has text, a handoff has a reason, a skip has neither, there is at least one
  keyword, a private message is never on a DM-only rule, reply text is not blank), so the reply pipeline can rely on
  them. The upgrade refuses a table that still holds rows in the old shape; the downgrade deletes all rules, because
  the old shape cannot represent them, which also keeps downgrade-then-upgrade working.
- `messages.automation_rule_id` (migration `0007`, nullable FK, `ON DELETE SET NULL`) names the rule that wrote a
  message, `NULL` for the AI and for people. Rules are soft-deleted, so a deleted rule's messages stay traceable.
- `messages` is indexed by `(organization_id, created_at)` (migration `0004`) because analytics aggregates one
  organization's messages over a date range; on a very large live table build that index `CONCURRENTLY`.
- `audit_logs` has no foreign keys on purpose: rows outlive deleted users and organizations.
- Plan limits are data (`plan_limits`, per-org `usage_limits`), never hard-coded.
