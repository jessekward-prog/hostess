# Hostess

A tiny self-hosted PaaS for one Linux box: paste a git URL (or local path), it builds a Docker
image, wires up Postgres if the app needs one, and runs it on an auto-picked port. Dashboard +
CLI, no external accounts, nothing leaves the machine.

## Install

Full walkthrough with copy-paste commands for every option: **[hostess.cmdward.xyz](https://hostess.cmdward.xyz)**

**Linux** (Debian/Ubuntu-family):
```
curl -fsSL https://raw.githubusercontent.com/jessekward-prog/hostess/main/install.sh | bash
```

**macOS:**
```
curl -fsSL https://raw.githubusercontent.com/jessekward-prog/hostess/main/install-macos.sh | bash
```

**Windows** (PowerShell — re-launches itself elevated, approve the UAC prompt):
```
iwr -useb https://raw.githubusercontent.com/jessekward-prog/hostess/main/install.ps1 | iex
```

Each installs Docker/Node/git if missing, clones the repo to `~/hostess`
(`$HOME\hostess` on Windows), and registers a persistent background service —
a user-level systemd service on Linux, a launchd agent on macOS, a Scheduled Task on Windows —
so the dashboard survives reboots and logouts.

Already have the repo checked out? Run the installer for your OS from inside it instead — it
detects the existing checkout and skips the clone.

Dashboard: **http://localhost:5300** (binds to loopback only — not reachable off the box).

Manage the service:

| OS | Status | Restart | Stop |
|---|---|---|---|
| Linux | `systemctl --user status hostess` | `systemctl --user restart hostess` | `systemctl --user stop hostess` |
| macOS | `launchctl list \| grep hostess` | `launchctl load -w ~/Library/LaunchAgents/xyz.cmdward.hostess.plist` | `launchctl unload ~/Library/LaunchAgents/xyz.cmdward.hostess.plist` |
| Windows | `Get-ScheduledTask -TaskName hostess` | `Start-ScheduledTask -TaskName hostess` | `Stop-ScheduledTask -TaskName hostess` |

## Deploying an app

Any repo you point it at needs two files at its root:

**`app.yaml`**

```yaml
name: my-app          # lowercase letters/numbers/hyphens, 2-50 chars
port: 3000             # port your app listens on *inside* the container
postgres: false        # true to get a DATABASE_URL env var wired to a shared Postgres
env:                   # optional — documents required var names; not yet injected at deploy
  - SOME_KEY            # time (see Known limitations) — give the app its own way to set these
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

## Known limitations

- **`app.yaml`'s `env` list isn't injected yet.** It's parsed and stored, but nothing collects
  values for it or passes them to the container — the only env variable actually set today is
  `DATABASE_URL` (when `postgres: true`). Until a deploy-time prompt exists, give your app its
  own way to set config post-deploy (an admin UI backed by its own DB, for example) rather than
  relying on `env:` to deliver secrets.

## Requirements

- Docker (installer adds you to the `docker` group — needs a fresh login to take effect)
- Node.js 18+
- git (only needed for remote sources; local paths don't need it)
