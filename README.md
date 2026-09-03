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
autoUpdate: false       # true to auto-redeploy whenever the source repo gets a new commit
env:                   # optional — names Hostess will prompt for on the app card ("env" panel)
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
- **MY AI:** sidebar panel (bottom-left) where you point Hostess at your own local LM Studio,
  Ollama, or text-generation-webui — address, optional API key, and which loaded model to use.
  Same "paste your server info" pattern as shelf-cmd's MY AI panel. Nothing is set until you set
  it; settings persist in `settings.json` (**not committed** — holds a live API key if you set
  one). `HOSTESS_GUARD_LM_URL` / `HOSTESS_GUARD_LM_KEY` / `HOSTESS_GUARD_LM_MODEL` env vars work
  as a headless fallback if you never touch the panel.
- **Security guard:** once a model is connected, every deploy gets its `Dockerfile`, `app.yaml`,
  and entrypoint file reviewed before building — framed as "would this be dangerous for an
  ordinary person to run on their own computer," covering both malicious code (hardcoded secrets,
  curl-pipe-to-bash, exfiltration, obfuscation) and home-hosting exposure (requests for
  privileged/docker-socket/host-network access, unauthenticated admin endpoints, LAN scanning).
  Each finding comes with a plain-language reason, not jargon. `risk: high` blocks the deploy
  (reason shown in the dashboard/CLI); `low`/`medium` just get logged and shown as a
  `guard: <risk>` chip on the app card (hover for details). No model connected, or the LLM's
  unreachable mid-scan → scan is skipped and the deploy proceeds unscanned — see `lib/guard.js`.
- **Env values:** any name listed under `app.yaml`'s `env:` gets its own reveal panel on the app
  card ("env", next to "show logs") — one password-style input per name, a green dot once it's
  set. Save writes it into `registry.json` and redeploys so the container actually gets it via
  `docker run -e`. Values are never sent back to the browser once saved (the panel only shows
  whether a name is set, not its value) — `PUT /api/apps/:name/env` to set programmatically.
- **Auto-update:** `autoUpdate: true` in `app.yaml` polls the source repo's default branch every
  ~10 minutes (`git ls-remote`, no clone) and redeploys automatically when the commit changes —
  see `lib/autoupdate.js`. Local-path sources are skipped (no remote to poll). Off by default.
- **AI link (per-app toggle):** an app gets a live Local/Claude toggle on its card — switch
  providers, no redeploy — if it implements its own `GET/PUT /api/lm`, protected by a
  `SYNC_SECRET` env var (auto-generated by Hostess the first time `SYNC_SECRET` appears in
  `app.yaml`'s `env:` — no need to set it yourself). Contract, checked against `x-sync-secret`
  header on both verbs:
  - `GET /api/lm` → `{ provider: 'local'|'anthropic', local: { url, model, apiKeySet, models: [] },
    anthropic: { apiKeySet, model } | null, managedEnv: ['LM_STUDIO_URL', ...] }`. Omit `anthropic`
    entirely (not `{apiKeySet:false}`) if the app has no Claude option — Hostess then skips the
    toggle and shows the local fields directly. `managedEnv` lists which env var names this
    endpoint owns, so Hostess hides them from the raw env panel instead of showing both.
  - `PUT /api/lm` body → `{ provider, url?, apiKey?, model? }` (local) or `{ provider: 'anthropic',
    apiKey? }` (Claude) — apply immediately, no restart needed. See `lib/ailink.js` (Hostess side)
    and shelf-cmd's `/api/lm` (`server/index.js`) for a working reference implementation.

## Requirements

- Docker (installer adds you to the `docker` group — needs a fresh login to take effect)
- Node.js 18+
- git (only needed for remote sources; local paths don't need it)
