# OpenCode self-hosted deployment

This directory deploys a single-tenant instance of OpenCode — the headless `opencode serve`
API together with the embedded web UI — onto a small virtual private server (VPS).
It is fully scripted: you fill in a few secrets and run one command.

The deployment ships:

- A Docker image that compiles the `opencode` standalone binary **from this repo's source**
  (with the web UI embedded) so you always run the exact version you have checked out.
- A `docker compose` stack of two services: `opencode` (API + UI on `:4096`) and
  `caddy` (auto-HTTPS reverse proxy on `:80`/`:443`).
- Persistent Docker **volumes** for sessions, SQLite, `auth.json`, `opencode.json`,
  and the agent's working directory — none of which are touched on image rebuilds.
- Two shell scripts: `deploy.sh` (one-command first run) and `update.sh` (one-command
  rolling update).
- A default `opencode.json` that pins `nvidia/glm-5.2` as the model.

---

## TL;DR — the four commands you actually run

```bash
# On the server (after cloning this repo):
cd opencode-dev/infra/deploy
cp .env.example .env
$EDITOR .env                         # fill in OPENCODE_DOMAIN, OPENCODE_SERVER_PASSWORD, NVIDIA_API_KEY
./deploy.sh                          # builds, starts, prints your https:// URL

# Later, from the same directory on the server, to apply any update:
git pull && ./update.sh
```

That is the entire ongoing workflow.

---

## Why a VPS over a managed PaaS

This project is a long-running, **stateful** coding agent that:

| Requirement                                         | VPS + Compose | Fly  | Render | Cloud Run |
| --------------------------------------------------- | :-----------: | :--: | :----: | :-------: |
| Spawns PTYs and long-lived child processes          | **Yes**       | ok   | ok     | no        |
| Durable local SQLite + sessions on local FS         | **trivial**   | vol. | disk$  | no        |
| WebSocket PTY streaming                             | **native**    | yes  | yes    | awkward   |
| Full process control for debugging                  | **ssh in**    | exec  | exec   | hard      |
| Cost for a single always-on user                    | **$5–10/mo**  | ~$5  | ~$7    | by-req    |
| Downtime-free image rebuilds without state migration | **volumes** | vol. | disk   | no        |

The decisive factors are PTY/process execution and durable local filesystem — both are
first-class on a plain VPS with a Docker volume, and painful or pricier on every managed
platform. For a single-tenant, always-on agent, a VPS is the cheapest, most predictable,
and most maintainable choice. The total cost was the deciding factor for the chosen
default: a Hetzner CX22 (2 vCPU / 4 GB, €3.79/mo) or DigitalOcean Droplet ($6/mo, 1 GB)
is enough for one user. Cloud Run was eliminated because of its per-request timeout and
no long-lived process support; Fly and Render were viable but cost more for the same
always-on shape and give less control for filesystem/process debugging.

### Recommended VPS providers (pick one)

- **Hetzner Cloud** — best price/perf. CX22 €3.79/mo, 2 vCPU/4 GB. Region: any.
- **DigitalOcean** — Droplet Premium AMD 1 GB, $6/mo. Best-onboarding UX.
- **AWS Lightsail** — 1 GB, $5/mo. Already-in-AWS users.

All three work identically with this stack. Hetzner is the cheapest for a single user.

---

## Prerequisites on the server

1. A fresh VPS running **Debian 12 / Ubuntu 24.04 / Alpine 3.20** (or any Linux with `glibc` ≥ 2.31).
2. **Docker Engine 24+** and the **Compose v2 plugin**. Quick install on Debian/Ubuntu:
   ```bash
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker $USER     # then log out and back in
   ```
3. **Ports 80 and 443** open to the internet (Caddy uses `:80` for Let's Encrypt HTTP-01
   and `:443` for HTTPS).
4. A **DNS A record** for your chosen hostname pointing at the server's public IPv4, e.g.:
   ```
   opencode.example.com.   A   300   203.0.113.10
   ```
   Wait for DNS to propagate before running `deploy.sh` — Caddy will fail to obtain a
   certificate otherwise. Verify with `dig +short opencode.example.com`.
5. The repo cloned on the server:
   ```bash
   git clone https://github.com/<you>/opencode.git opencode-dev
   cd opencode-dev/infra/deploy
   ```

You'll also need a **GLM-5.2 NVIDIA API key** — get one free at
<https://build.nvidia.com/> (log in, then "Get API Key"). The key is
`nvapi-...` and goes into `NVIDIA_API_KEY` in `.env`.

---

## Required secrets (everything you must fill in)

Every value below is marked `PLACEHOLDER` in `.env.example`. Copy the file to `.env`
and replace the placeholders. **The `.env` file must never be committed** — it is
ignored by `.gitignore` via the repo's root `.dockerignore` and the deploy scripts
load it with `set -a; . .env; set +a`.

| Variable                    | Description                                                              | How to generate / where to get it                         |
| --------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------- |
| `OPENCODE_DOMAIN`            | Hostname Caddy will serve over HTTPS                                     | Any domain you own, with an A record pointed at the VPS |
| `OPENCODE_DOMAIN_EMAIL`      | Optional; used by Let's Encrypt for expiry warnings                       | Your email                                                |
| `OPENCODE_SERVER_USERNAME`   | Browser Basic-auth username                                              | Any short string; default `opencode`                     |
| `OPENCODE_SERVER_PASSWORD`   | Browser Basic-auth password (also gates every API call)                  | `openssl rand -base64 32` (keep this secret forever)     |
| `NVIDIA_API_KEY`             | The free GLM-5.2 provider key                                            | <https://build.nvidia.com/> → Get API Key                |
| `GIT_AUTHOR_*` / `GIT_COMMITTER_*` | Identity for commits the agent makes inside the container       | Anything; defaults to `opencode@localhost`                |

`OPENCODE_SERVER_PASSWORD` is the **single most important secret**. Anyone with it can
drive your agent and read/write files in the workspace volume. Store it in a password
manager. The deploy script refuses to start if it looks weak or is still a placeholder.

> ⚠️ The `.env` file is the complete secret surface. There are no other hidden secrets —
> no Stripe, Cloudflare, or S3 keys are required for this single-tenant deployment.

---

## First-time deploy

```bash
cd infra/deploy
cp .env.example .env
$EDITOR .env                  # fill in every PLACEHOLDER value
./deploy.sh
```

`deploy.sh` does, in order:

1. Loads `.env` and validates that no `PLACEHOLDER` remains and that the password is set.
2. Creates the three persistent Docker volumes (`opencode-config`, `opencode-data`,
   `opencode-workspace`) **before** the opencode container starts.
3. Seeds `opencode.json` (this directory's version) into the `opencode-config` volume
   **only on first run** — it will never overwrite your edits on later deploys.
4. Builds the `opencode` Docker image from source (`docker compose build opencode`).
   First build is slow (~5–10 min on a 2-vCPU VPS) as it compiles the binary; subsequent
   builds use the layer cache and finish in seconds.
5. Brings up both containers with `docker compose up -d`.
6. Waits for the `opencode` container's healthcheck to flip to `healthy`.
7. Prints the final HTTPS URL.

When it finishes, visit `https://OPENCODE_DOMAIN`. Your browser will prompt for the
`OPENCODE_SERVER_USERNAME` / `OPENCODE_SERVER_PASSWORD` pair — enter them, and you'll
land in the embedded web UI running against `nvidia/glm-5.2`.

---

## Post-deployment workflow — how you update in the future

You picked the **manual one-command** update flow. Here is the exact procedure.

### Routine update (apply new commits from the repo)

```bash
ssh user@your-vps
cd ~/opencode-dev          # or wherever you cloned it
git pull --ff-only         # bring down the new commits
cd infra/deploy
./update.sh                # rebuild + roll the opencode container
```

`update.sh` does:

1. (Optional) If you pass a git ref, e.g. `./update.sh v1.18.14`, it checks out that ref
   first. Otherwise it builds from whatever your working tree currently has — so you
   always `git pull` (or `git checkout <tag>`) yourself before running it.
2. `docker compose build opencode` — recompiles the binary from the new source. Thanks
   to BuildKit layer caching, only the changed layers re-run; in practice this is fast
   unless `package.json` / `bun.lock` changed.
3. `docker compose up -d` — recreates only the `opencode` container (its image changed);
   `caddy` is untouched. Volumes are preserved, so there is **zero data loss** and the
   wall-clock gap is only the few seconds opencode needs to bind its port.
4. Prunes dangling builder images so the VPS disk does not slowly fill.

That's the whole update story. There is no database migration step — opencode's Drizzle
migrations are applied automatically by core on startup.

### Recommended update strategy

- **Manual `git pull && ./update.sh`** is the default and the right choice for a single
  user. The deployment is purely declarative (Compose + Dockerfile), so the script is the
  only update path; nothing else to remember.
- **If you later want push-to-deploy** (auto-deploy on every commit to your `dev` branch),
  the optional GitHub Actions workflow in `infra/deploy/ci.yml` is ready to enable: it SSHes
  into your VPS and runs `update.sh`. To enable it, add two secrets to the GitHub repo
  (`OPENCODE_SSH_HOST`, `OPENCODE_SSH_KEY`) and uncomment the trigger at the top of the
  workflow file. It is shipped disabled so nothing auto-deploys until you opt in.
- **Rolling/zero-downtime updates** are not needed for a single-user agent — the brief
  port-bind gap on container recreation (a few seconds) is acceptable. If you genuinely
  need it later, front the stack with a second Caddy instance and run two `opencode`
  replicas behind it, draining one at a time. The current setup is deliberately simple.

### Versioning & rollback

- **Pin to a tag**: `./update.sh v1.18.14` checks out that tag and builds it. Useful if a
  newer commit regresses something.
- **Roll back**: `./update.sh <previous-commit-or-tag>`. Docker keeps the old images
  around until you `docker image prune`; the volumes (your data) are never rebuilt.
- **See what's running**: `docker compose ps` shows the container uptime; `opencode --version`
  inside the container prints the build's embedded version string:
  ```bash
  docker compose exec opencode opencode --version
  ```

---

## Operations & troubleshooting

### Logs

- Live logs of both services:
  ```bash
  docker compose logs -f
  docker compose logs -f opencode    # just the agent
  docker compose logs -f caddy        # just the proxy / ACME challenges
  ```
- Persistent logs go to stdout/stderr and Docker's `json-file` log driver. The compose
  file does not cap log size by default; to add a cap, extend the `opencode` service with
  `logging: { driver: json-file, options: { max-size: "10m", max-file: "3" } }`.

### Health

```bash
docker compose ps                 # shows health: (healthy|unhealthy|starting)
curl -fsS https://$OPENCODE_DOMAIN/doc | head   # OpenAPI schema if healthy
docker inspect --format '{{.State.Health.Status}}' opencode
```

The healthcheck runs `opencode api session list` inside the container, which exercises the
whole stack (CLI → server → SQLite). Failure means the server isn't answering on its port.

### TLS certificate

Caddy obtains the certificate automatically on first boot and renews it silently before
expiry. If the cert is stuck:

```bash
docker compose logs caddy | grep -i acme
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile
docker compose restart caddy
```

Cert data lives in the `opencode_caddy-data` volume — do not delete it or you'll re-issue
(and hit Let's Encrypt rate limits).

### Backups

All durable state is on three named volumes. Back them up with one `docker run`:

```bash
# Tar the three state volumes into /backup on the host
for v in opencode_opencode-data opencode_opencode-config opencode_opencode-workspace; do
  docker run --rm -v "${v}:/data" -v "$HOME/backups:/backup" alpine \
    tar -czf "/backup/${v}-$(date +%F).tgz" -C /data .
done
```

Restore is the inverse (`tar -xzf ... -C /data`). The `opencode-data` volume contains
`auth.json` (your provider keys) — treat backups of it as secrets.

### Reset / teardown

```bash
docker compose down -v   # ⚠️ also deletes the volumes and all your sessions
```

### Changing the LLM model / provider

Edit the `opencode.json` on the config volume:
```bash
docker compose exec opencode sh -c 'cat $OPENCODE_CONFIG_DIR/opencode.json'
# or mount the volume directly:
docker run --rm -v opencode_opencode-config:/cfg alpine vi /cfg/opencode.json
```
Then `docker compose restart opencode`. You don't need to rebuild the image.

### Changing server secrets

Edit `.env`, then `docker compose up -d` to recreate containers with the new env (volumes
preserved). The password is read at process start, so a `restart` is sufficient.

---

## File map of `infra/deploy/`

| File               | Purpose                                                        |
| ------------------ | ------------------------------------------------------------- |
| `Dockerfile`        | Multi-stage build: Bun compiles the standalone binary; runtime on Alpine |
| `docker-compose.yml`| Defines the `opencode` + `caddy` services and three volumes  |
| `Caddyfile`         | Auto-HTTPS reverse proxy with security headers + WS support   |
| `opencode.json`     | Default config seeded into the volume on first run only      |
| `.env.example`      | Template for all required secrets (with placeholders)         |
| `deploy.sh`         | One-command first deploy (validate → seed → build → up)       |
| `update.sh`         | One-command rolling update (pull → build → up → prune)        |
| `ci.yml`            | Optional, disabled-by-default GitHub Actions auto-deploy      |
| `DEPLOYMENT.md`     | This document                                                 |

---

## Security notes

- The opencode server is reachable only through Caddy, which forces HTTPS with HSTS.
- HTTP Basic auth (`OPENCODE_SERVER_PASSWORD`) gates **every** request, including the API.
  Use a 32+ char random password. The browser will cache the credentials for the session.
- The workspace volume is writable by the `opencode` user (uid 1000) inside the container.
  The container does not run as root and has no escalated capabilities.
- Secrets live only in `.env` on the VPS and are injected via `environment` (not baked into
  the image). The image contains no credentials and is safe to push to any registry.
- For a stronger posture later, put the VPS behind Cloudflare Access (zero-trust) and let
  it handle the auth layer; the compose stack already exposes plain HTTPS that Cloudflare
  can front without modification.

---

## Its overall design choice (recap)

**Host:** a small VPS (Hetzner CX22 / DO Droplet, 1–2 GB RAM).
**Runtime:** Docker Compose, two services, three named volumes.
**TLS:** Caddy auto-certs from Let's Encrypt, no manual certificate management.
**Updates:** `git pull && ./update.sh` (manual, single command, zero data loss).
**Secrets:** one `.env` file on the host; no secrets in the image.
**Cost:** ~$5/mo, fixed. No per-request pricing surprises.

This is the cheapest, most debuggable, and most maintainable option for a single-user,
always-on, stateful coding agent, and it requires only the four commands at the top of
this document to operate indefinitely.
