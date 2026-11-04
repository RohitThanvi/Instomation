# Deploying on an Oracle Cloud Always Free VM

One VM runs everything from `docker-compose.yml` plus Caddy (`docker-compose.prod.yml`) as the only public
entry point. **None of this has been run**: the sandbox has no Docker and no Oracle account. Treat every step as a
checklist to verify, and report what differs.

## Read this first

- **The free allowance is unclear.** Oracle's own page, as retrieved while writing this, still described the
  Ampere A1 allowance as 4 OCPUs and 24 GB. Several 2026 write-ups and community posts say it was cut to 2 OCPUs and
  12 GB for Always Free tenancies, and some report instances being disabled after the change. Plan for 2 OCPUs and
  12 GB. The stack idled at roughly 440 MB for the API and four workers in a sandbox (not a load test), so it should
  fit; measure with `docker stats` after launch.
- **"Out of host capacity" is common** when creating an A1 instance. It means Oracle has no free A1 capacity in that
  region or availability domain. Try another availability domain or wait. The home region is chosen at sign-up and
  cannot be changed.
- **Idle reclaim.** Oracle can reclaim Always Free compute whose utilisation stays very low for a week. A real
  workload counts; artificial load is a violation and is not a fix.
- **No DDoS protection and a single machine.** The app rate-limits requests (see `docs/SECURITY.md`) but a flood
  that saturates the VM's network is beyond it. Put Cloudflare (free plan) in front if that matters.
- **You are the operator.** There is no managed database: backups, patching and disk space are yours.

## 1. Create the instance

- Shape `VM.Standard.A1.Flex`, image Ubuntu 24.04 (aarch64), 2 OCPUs and 12 GB (or what your tenancy allows), the
  default boot volume (the minimum is around 47 GB), your SSH public key.
- Reserve the public IP so it survives re-creating the instance, then point your domain's **A record** at it. Caddy
  needs a real hostname; a bare IP gets no trusted certificate. Use a domain you own or a dynamic-DNS subdomain.

## 2. Open only what is needed

In the VCN security list for the instance's subnet add ingress rules:

| Port | Source | Why |
|---|---|---|
| TCP 22 | your own IP only | SSH |
| TCP 80, TCP 443, UDP 443 | 0.0.0.0/0 | Caddy (certificate challenge, HTTPS, HTTP/3) |

Nothing else. In particular never open 5432, 6379, 8000 or 5173: the compose file already binds those to
127.0.0.1, and Docker-published ports bypass the host firewall, so the security list is the only outer barrier.

If the site does not answer after that, Oracle's Ubuntu images ship restrictive `iptables` rules; insert
`ACCEPT` rules for the same ports at the top of the `INPUT` chain and persist them with `iptables-persistent`.

## 3. Prepare the VM

```bash
sudo apt-get update && sudo apt-get -y upgrade
sudo apt-get install -y unattended-upgrades
# Docker Engine and the compose plugin from Docker's apt repository (arm64):
#   follow https://docs.docker.com/engine/install/ubuntu/
sudo usermod -aG docker "$USER"   # log out and back in
```

Cap container logs, or they fill the boot disk. Create `/etc/docker/daemon.json`, then `sudo systemctl restart docker`:

```json
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }
```

Harden SSH: keys only (`PasswordAuthentication no` in `/etc/ssh/sshd_config`), and keep the port-22 rule above.

## 4. Configure

```bash
git clone https://github.com/RohitThanvi/Instomation.git && cd Instomation
cp .env.example .env && chmod 600 .env
```

Edit `.env`. Replace every secret with a fresh value (generate `TOKEN_ENCRYPTION_KEY` with
`python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`). With `app.example.com`
standing for your hostname:

| Variable | Value |
|---|---|
| `APP_ENV` | `production` |
| `SITE_ADDRESS` | `app.example.com` |
| `ACME_EMAIL` | a mailbox you read |
| `POSTGRES_PASSWORD` | a long random password (the prod overlay refuses to start without it) |
| `TRUSTED_PROXY_COUNT` | `1` (Caddy is the one proxy in front of the API; verified that Caddy overwrites a spoofed `X-Forwarded-For`) |
| `FRONTEND_BASE_URL`, `CORS_ALLOWED_ORIGINS`, `CLERK_AUTHORIZED_PARTIES`, `VITE_API_BASE_URL` | `https://app.example.com` (one origin serves both the app and `/api`) |
| `META_REDIRECT_URI` | `https://app.example.com/api/v1/instagram/oauth/callback` |
| `VITE_LEGAL_ENTITY_NAME`, `VITE_LEGAL_CONTACT_EMAIL` | the operator named on the legal pages |
| `CLERK_*`, `VITE_CLERK_PUBLISHABLE_KEY`, `META_*`, `GROQ_API_KEY` | your production values; never commit `.env` |

Add the hostname to your Clerk instance's allowed origins and the redirect URI to the Meta app.

## 5. Start

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

The first build compiles for arm64 and takes a while. Migrations run automatically (the `migrate` service). The API
and everything behind it are only reachable through Caddy; `/health` and `/ready` are deliberately not public, so
check them on the VM:

```bash
curl -fsS http://127.0.0.1:8000/health
curl -fsS http://127.0.0.1:8000/ready
curl -fsS https://app.example.com/robots.txt     # crawler rules, naming your host
```

Then follow `docs/DEPLOYMENT.md` for the Meta webhook and `docs/META_APP_REVIEW.md` for the compliance fields.

## 6. Keep it alive

- **Backups.** Nightly, and copy them off the machine (an Oracle boot volume is not a backup):

  ```bash
  mkdir -p ~/backups
  docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-instomation}" "${POSTGRES_DB:-instomation}" \
    | gzip > ~/backups/instomation-$(date +%F).sql.gz
  find ~/backups -name '*.sql.gz' -mtime +14 -delete
  ```

  Run it from cron, ship the files to object storage with `rclone`, and practise one restore into a scratch database.
  Neither the dump nor the restore has been run.
- **Updates.** `git pull && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build`.
- **Disk.** Image builds accumulate: run `docker system prune -f` weekly.
- **Certificates** renew automatically while the `caddy_data` volume survives.

## Not verified

The whole procedure; the arm64 image builds; certificate issuance; Oracle's current free limits and reclaim
behaviour; the backup commands; memory use under load.
