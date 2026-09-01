# Self-Host Wizard

A tiny self-hosted PaaS for one Linux box: paste a git URL (or local path), it builds a Docker
image, wires up Postgres if the app needs one, and runs it on an auto-picked port. Dashboard +
CLI, no external accounts, nothing leaves the machine.

## Install

```
curl -fsSL https://raw.githubusercontent.com/jessekward-prog/selfhost-wizard/main/install.sh | bash
```

This installs Docker/Node/git if missing, clones the repo to `~/selfhost-wizard`, and registers
a user-level systemd service so the dashboard survives reboots and logouts.

Already have the repo checked out? Run `./install.sh` from inside it instead — it detects the
existing checkout and skips the clone.

Dashboard: **http://localhost:5300** (binds to loopback only — not reachable off the box).

Manage the service:

```
systemctl --user status  selfhost-wizard
systemctl --user restart selfhost-wizard
systemctl --user stop    selfhost-wizard
```

## Deploying an app

Any repo you point it at needs two files at its root:

**`app.yaml`**

```yaml
name: my-app          # lowercase letters/numbers/hyphens, 2-50 chars
port: 3000             # port your app listens on *inside* the container
postgres: false        # true to get a DATABASE_URL env var wired to a shared Postgres
env:                   # optional — extra env var names (values come from the deploy)
  - SOME_KEY
```

**`Dockerfile`** — anything that builds and listens on `port`.

Then either paste the repo URL / local path into the dashboard form, or from the CLI:

```
node deploy.js https://github.com/you/your-app
node deploy.js /path/to/local/repo
```

Redeploying the same app name reuses its host port and container name, and — if it uses
Postgres — its existing database and role, so `DATABASE_URL` doesn't rotate on every deploy.

## How it works

- `apps/<name>/` — the fetched repo (git clone or local copy)
- `registry.json` — deploy state per app (port, image, Postgres credentials) — **not
  committed**, it holds live secrets
- One shared `postgres:16-alpine` container (`selfhost-postgres`) on a dedicated Docker
  network; each Postgres-backed app gets its own database + role inside it
- Host ports are auto-assigned from the `4000–4999` range and stick for the life of the app

## Requirements

- Docker (installer adds you to the `docker` group — needs a fresh login to take effect)
- Node.js 18+
- git (only needed for remote sources; local paths don't need it)
