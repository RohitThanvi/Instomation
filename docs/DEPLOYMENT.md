# Deployment

How to run Instomation outside a laptop. `docker-compose.yml` is the reference layout; every other host
(Fly.io, Oracle Cloud, a plain VM) runs the same processes with the same environment variables.

## Process layout

One image (`backend/Dockerfile`) runs every backend process; the command and `WORKER_QUEUE` choose the role.

| Process | Command | Replicas | Role |
|---|---|---|---|
| `migrate` | `alembic upgrade head` | one-shot per release | Applies migrations, then exits |
| `api` | `uvicorn app.main:app --host 0.0.0.0 --port 8000` | 1 or more | HTTP API, webhook receiver (`/health`, `/ready`) |
| `worker-events` | `arq app.workers.settings.WorkerSettings` with `WORKER_QUEUE=events` | 1 or more | Turns stored webhook events into conversations and messages |
| `worker-ai` | same, `WORKER_QUEUE=ai` | 1 or more | Moderation and reply generation |
| `worker-instagram` | same, `WORKER_QUEUE=instagram` | 1 or more | Sends DMs and comment replies to Meta |
| `worker-maintenance` | same, `WORKER_QUEUE=maintenance` | **exactly 1** | Cron: requeue stale jobs, purge old records, refresh Instagram tokens |
| `frontend` | static files behind nginx (`frontend/Dockerfile`) | 1 or more, or any static host | The SPA |

A worker consumes exactly the queue named by `WORKER_QUEUE`. **A queue with no worker is silently never
processed**: webhooks would be accepted and then never handled. A worker refuses to start for a queue with
nothing registered, and `tests/test_deployment.py` and `tests/test_worker_registry.py` guard both the compose
file and the handler registry.

PostgreSQL and Redis are separate services. PostgreSQL is the source of truth; Redis holds queues, locks, rate
limits and caches, and queue loss is repaired from PostgreSQL (see `docs/ARCHITECTURE.md`).

## Environment variables

`.env.example` documents every setting inline, and `tests/test_deployment.py` fails if it drifts from the code.
Never commit real values.

Settings with no default (the backend will not start without them):
`FRONTEND_BASE_URL`, `DATABASE_URL`, `REDIS_URL`, `CLERK_JWKS_URL`, `CLERK_ISSUER`, `TOKEN_ENCRYPTION_KEY`,
`META_APP_ID`, `META_APP_SECRET`, `META_REDIRECT_URI`.

Also needed for a working deployment:

- `META_WEBHOOK_VERIFY_TOKEN`: the webhook receiver answers 503 until it is set (it fails closed).
- `GROQ_API_KEY` (or `OPENAI_API_KEY` with `AI_PRIMARY_PROVIDER=openai`): without a key no AI call succeeds.
- `APP_ENV=production` additionally requires `CLERK_AUTHORIZED_PARTIES` and `CORS_ALLOWED_ORIGINS`; both must
  contain the frontend origin.
- `TOKEN_ENCRYPTION_KEY` is a Fernet key. Losing it makes every stored Instagram token unreadable (accounts must
  reconnect). Rotate with `TOKEN_ENCRYPTION_PREVIOUS_KEYS`.

The frontend takes `VITE_API_BASE_URL` and `VITE_CLERK_PUBLISHABLE_KEY` **at build time**; they are public and
baked into the bundle, so changing them means rebuilding the frontend.

Compose overrides `DATABASE_URL` and `REDIS_URL` for its own containers; everything else comes from `.env`.

## Migrate on release

Run `alembic upgrade head` once per release, as its own step, before starting the new API and workers. Do not
put it in every replica's start-up command. Compose does this with the one-shot `migrate` service, and the API
and workers wait for it to complete. Check what is applied with `alembic current` (head is `0005`), and confirm
models and migrations agree with `alembic check` (CI runs both against an empty database on every change).

Every schema change ships an Alembic migration. Migration `0004` adds an index on `messages`; on a large live
table build it `CONCURRENTLY` (see `docs/DATABASE.md`). Whether old code keeps working against a freshly migrated schema is
not checked, so for the first launch stop the processes, migrate, then start them.

## Scaling rules

- **API:** stateless; add replicas freely. Rate limits and locks live in Redis, so replicas share them.
- **`events`, `ai`, `instagram` workers:** scale by running more processes. Per-conversation ordering is enforced
  by a Redis lock, not by having a single worker.
- **`maintenance`: keep at 1 replica.** It runs the cron sweepers; a second copy would run them twice.
- **Database connections:** each process keeps its own pool. The ceiling is
  `(DB_POOL_SIZE + DB_MAX_OVERFLOW) x number of processes`, which is `(5 + 5) x 5 = 50` with the defaults (API
  plus four workers). Compare that with your provider's connection limit before adding replicas, and lower the
  pool settings if needed.
- **AI throughput:** `AI_RATE_LIMIT_PER_MINUTE` is shared across the whole deployment and
  `AI_RATE_LIMIT_PER_MINUTE_PER_TENANT` per organization. One DM costs two model calls (safety check, then reply).
  Set them to your provider's real limits; the gateway never rotates keys to get around a limit.
- **Liveness:** workers refresh a health key every `WORKER_HEALTH_CHECK_SECONDS` (30 by default), and
  `arq app.workers.settings.WorkerSettings --check` fails when the worker is dead or stuck. The compose health
  checks use it; reuse it as the health check on any host.

## Webhook and OAuth setup (Meta)

1. In the Meta app, set the webhook **callback URL** to `https://<api-host>/api/v1/instagram/webhooks` and the
   **verify token** to the value of `META_WEBHOOK_VERIFY_TOKEN`. Meta calls it once with a handshake; the API
   answers only when the token matches.
2. Subscribe the fields in `META_WEBHOOK_FIELDS` (default `comments,messages`).
3. Deliveries are accepted only with a valid `X-Hub-Signature-256` made with `META_APP_SECRET`; the endpoint is
   unauthenticated by design and must be reachable from the public internet over HTTPS.
4. Register `META_REDIRECT_URI` (`https://<api-host>/api/v1/instagram/oauth/callback`) as an OAuth redirect URI in
   the Meta app. After the round trip the browser lands on `FRONTEND_BASE_URL` + `OAUTH_RESULT_PATH`.
5. Each connected account is subscribed to webhooks during OAuth. If that call fails the account is stored with
   `webhook_subscribed=false` and the UI says it is not receiving messages yet; it is never reported as live.
6. Until the app passes Meta App Review and Business Verification, only the app's own roles and testers can
   connect accounts.

## Free-tier path

| Layer | Option |
|---|---|
| Frontend | Cloudflare Pages or Vercel (static build of `frontend/`) |
| API and workers | One VM running the five backend processes (Oracle Cloud Always Free, or Fly.io machines) |
| PostgreSQL | Neon or Supabase free tier |
| Redis | A Redis container on the same VM (no command quota); Upstash works but polling can use up its quota, so raise `WORKER_POLL_DELAY_SECONDS` |
| Auth | Clerk free tier |
| AI | Groq free tier |

Every host is selected through environment variables only; nothing in the code depends on a specific provider.

Sizing: on Python 3.12 with no traffic, the API process used about 97 MB and each worker about 85 MB resident
(roughly 440 MB for the API and four workers). That is an idle reading from a development sandbox, not a load
test, so leave headroom. Free-tier quotas and prices change, so check each provider's current terms; they were not
checked for this document.

Things to check on a managed PostgreSQL before launch:

- The database must be UTF-8 with a non-`C` ctype (`C.UTF-8` or `en_US.UTF-8`), or non-ASCII knowledge-base search
  (for example Devanagari) will not match.
- Use the direct (non-pooled) connection string for `alembic upgrade head`, and mind the connection ceiling above.
  Behaviour through a transaction-mode pooler has not been tested.

## After deploying

```bash
curl -fsS https://<api-host>/health          # {"status": ...}, process is up
curl -fsS https://<api-host>/ready           # {"status":"ready","database":"ok","redis":"ok"}
curl -fsS "https://<api-host>/api/v1/instagram/webhooks?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=ok"   # echoes: ok
```

Then confirm every worker is alive (`--check` exits 0) and send a test webhook from the Meta dashboard.

## Verification status

Verified in a development sandbox (no Docker): migrations from an empty PostgreSQL 16 database to head with
`alembic check` clean; the API and one worker per queue as real processes against real PostgreSQL and Redis, with
`/health`, `/ready` and every worker's `--check` passing; a genuinely HMAC-signed webhook accepted, stored and
marked done by the events worker, a replay creating no second row, and tampered, unsigned and wrong-token requests
rejected with 403.

**Not verified:** the compose stack and both images were never built or run; delivery to Meta's Graph API (the
sandbox cannot reach it); model quality against the real Groq API; behaviour on any managed PostgreSQL or Redis
provider; the CI workflow files themselves (their commands were run locally, but the workflows have not run on
GitHub).
