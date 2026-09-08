#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/jessekward-prog/hostess.git"
INSTALL_DIR="${HOSTESS_DIR:-$HOME/hostess}"
SERVICE_NAME="hostess"

echo "== hostess installer =="

SUDO=""
if command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi

# --- prerequisites ---
if ! command -v git >/dev/null 2>&1; then
  echo "Installing git..."
  $SUDO apt-get update -y && $SUDO apt-get install -y git
fi

NODE_MAJOR=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -v | sed 's/^v//;s/\..*//')"
fi
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Installing Node.js 20.x..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO bash -
  $SUDO apt-get install -y nodejs
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | $SUDO sh
  $SUDO usermod -aG docker "$USER"
  echo "Added $USER to the docker group — log out and back in (or run 'newgrp docker') before deploying anything."
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
ExecStart=/bin/bash -c 'git pull --ff-only && npm install --omit=dev && systemctl --user restart ${SERVICE_NAME}'
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
systemctl --user enable --now "$SERVICE_NAME"
systemctl --user enable --now "${SERVICE_NAME}-update.timer"
loginctl enable-linger "$USER" 2>/dev/null || true

echo ""
echo "hostess is running at http://localhost:5300"
echo "Manage it with: systemctl --user {status,restart,stop} $SERVICE_NAME"
sleep 1
command -v xdg-open >/dev/null 2>&1 && xdg-open "http://localhost:5300" >/dev/null 2>&1 || true
