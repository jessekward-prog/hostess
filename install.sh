#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/jessekward-prog/selfhost-wizard.git"
INSTALL_DIR="${SELFHOST_WIZARD_DIR:-$HOME/selfhost-wizard}"
SERVICE_NAME="selfhost-wizard"

echo "== selfhost-wizard installer =="

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
if [ -f "$SCRIPT_DIR/package.json" ] && grep -q '"name": "selfhost-wizard"' "$SCRIPT_DIR/package.json"; then
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
Description=Self-Host Wizard dashboard
After=network.target docker.service

[Service]
WorkingDirectory=$INSTALL_DIR
ExecStart=$(command -v node) server.js
Restart=on-failure

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now "$SERVICE_NAME"
loginctl enable-linger "$USER" 2>/dev/null || true

echo ""
echo "selfhost-wizard is running at http://localhost:5300"
echo "Manage it with: systemctl --user {status,restart,stop} $SERVICE_NAME"
