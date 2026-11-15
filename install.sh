#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/jessekward-prog/hostess.git"
INSTALL_DIR="${HOSTESS_DIR:-$HOME/hostess}"
SERVICE_NAME="hostess"

echo "== hostess installer =="

SUDO=""
if command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi

# git, curl and Node come from apt. On another distro, fail with a reason, not "apt-get: command not found".
need_apt() {
  if ! command -v apt-get >/dev/null 2>&1; then
    echo "This installer uses apt (Debian/Ubuntu family) and $1 is missing." >&2
    echo "Install Docker, Node.js 18+, git and curl yourself, then re-run this script." >&2
    exit 1
  fi
}

# --- prerequisites ---
if ! command -v git >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  need_apt "git or curl"
  echo "Installing git and curl..."
  $SUDO apt-get update -y && $SUDO apt-get install -y git curl ca-certificates
fi

NODE_MAJOR=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -v | sed 's/^v//;s/\..*//')"
fi
if [ "$NODE_MAJOR" -lt 18 ]; then
  need_apt "Node.js 18+"
  echo "Installing Node.js 20.x..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO bash -
  $SUDO apt-get install -y nodejs
fi

DOCKER_GROUP_JUST_ADDED=0
if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | $SUDO sh
  $SUDO usermod -aG docker "$USER"
  DOCKER_GROUP_JUST_ADDED=1
elif ! docker info >/dev/null 2>&1; then
  # Docker was already here but this user can't talk to it. Without this the service comes up
  # "active" and every deploy fails with permission denied.
  if ! id -nG "$USER" | tr ' ' '\n' | grep -qx docker; then
    echo "Adding $USER to the docker group..."
    $SUDO usermod -aG docker "$USER"
    DOCKER_GROUP_JUST_ADDED=1
  else
    echo "Warning: Docker is installed but not responding. Start it (sudo systemctl start docker), or log out and back in if you were only just added to the docker group." >&2
  fi
fi

# Go Online opens its links with cloudflared. Optional: everything else works without it.
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "Installing cloudflared (used by Go Online)..."
  deb="$(mktemp)"
  if command -v dpkg >/dev/null 2>&1 \
    && curl -fsSL -o "$deb" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$(dpkg --print-architecture).deb" \
    && $SUDO dpkg -i "$deb" >/dev/null; then
    :
  else
    echo "Couldn't install cloudflared. Go Online stays unavailable until you install it; everything else works." >&2
  fi
  rm -f "$deb"
fi

# --- fetch the app ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/package.json" ] && grep -q '"name": "hostess"' "$SCRIPT_DIR/package.json"; then
  INSTALL_DIR="$SCRIPT_DIR"
  echo "Running from existing checkout at $INSTALL_DIR"
elif [ -d "$INSTALL_DIR/.git" ]; then
  echo "Updating existing install at $INSTALL_DIR"
  git -C "$INSTALL_DIR" pull --ff-only
else
  echo "Cloning into $INSTALL_DIR"
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
npm install --omit=dev

# --- systemd user service (survives reboot via linger) ---
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=Hostess dashboard
After=network.target docker.service

[Service]
WorkingDirectory=$INSTALL_DIR
ExecStart=$(command -v node) server.js
Restart=on-failure

[Install]
WantedBy=default.target
EOF

cat > "$HOME/.config/systemd/user/${SERVICE_NAME}-update.service" <<EOF
[Unit]
Description=Hostess self-update
After=network.target

[Service]
Type=oneshot
WorkingDirectory=$INSTALL_DIR
ExecStart=/bin/bash -c 'old=\$(git rev-parse HEAD); git pull --ff-only && if [ "\$(git rev-parse HEAD)" != "\$old" ]; then npm install --omit=dev && systemctl --user restart ${SERVICE_NAME}; fi'
EOF

cat > "$HOME/.config/systemd/user/${SERVICE_NAME}-update.timer" <<EOF
[Unit]
Description=Hostess self-update timer

[Timer]
OnBootSec=5min
OnUnitActiveSec=1h

[Install]
WantedBy=timers.target
EOF

systemctl --user daemon-reload
systemctl --user enable "$SERVICE_NAME"
systemctl --user enable --now "${SERVICE_NAME}-update.timer"
loginctl enable-linger "$USER" 2>/dev/null || $SUDO loginctl enable-linger "$USER" 2>/dev/null \
  || echo "Warning: couldn't enable linger, so Hostess will stop when you log out. Run: sudo loginctl enable-linger $USER" >&2

if [ "$DOCKER_GROUP_JUST_ADDED" = "1" ]; then
  # This shell's own docker-group membership won't apply until a fresh
  # login, and systemd --user (already running before the usermod above)
  # would hand the service that same stale group list if started now — it'd
  # come up "active" but every docker call inside it would fail permission
  # denied. Enable it (survives reboot) but leave starting it for a session
  # that actually has the new group.
  echo ""
  echo "Docker was just installed and $USER was added to the docker group."
  echo "Log out and back in (or reboot), then run: systemctl --user start $SERVICE_NAME"
else
  systemctl --user start "$SERVICE_NAME"
  echo ""
  echo "hostess is running at http://localhost:5300"
  echo "Manage it with: systemctl --user {status,restart,stop} $SERVICE_NAME"
  sleep 1
  command -v xdg-open >/dev/null 2>&1 && xdg-open "http://localhost:5300" >/dev/null 2>&1 || true
fi
