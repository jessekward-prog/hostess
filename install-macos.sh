#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/jessekward-prog/hostess.git"
INSTALL_DIR="${HOSTESS_DIR:-$HOME/hostess}"
PLIST_LABEL="xyz.cmdward.hostess"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"

echo "== hostess installer (macOS) =="

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This script is for macOS. Use install.sh on Linux or install.ps1 on Windows." >&2
  exit 1
fi

# --- Homebrew ---
if ! command -v brew >/dev/null 2>&1; then
  echo "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"
fi

# --- prerequisites ---
if ! command -v git >/dev/null 2>&1; then
  echo "Installing git..."
  brew install git
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Installing Node.js..."
  brew install node
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker Desktop..."
  brew install --cask docker
fi

if ! docker info >/dev/null 2>&1; then
  echo "Starting Docker Desktop..."
  open -a Docker
  echo -n "Waiting for Docker to be ready (first run needs you to approve its permissions dialog)..."
  attempts=0
  until docker info >/dev/null 2>&1 || [ "$attempts" -ge 100 ]; do
    echo -n "."
    sleep 3
    attempts=$((attempts + 1))
  done
  if ! docker info >/dev/null 2>&1; then
    echo ""
    echo "Docker still isn't responding after 5 minutes. Open Docker Desktop, approve its permissions dialog, wait for the whale icon in the menu bar to say 'running', then re-run this script." >&2
    exit 1
  fi
  echo " ready."
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

# --- launchd agent (survives logout/reboot) ---
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(command -v node)</string>
    <string>server.js</string>
  </array>
  <key>WorkingDirectory</key><string>${INSTALL_DIR}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/hostess.log</string>
  <key>StandardErrorPath</key><string>/tmp/hostess.log</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl load -w "$PLIST_PATH"

echo ""
echo "hostess is running at http://localhost:5300"
echo "Manage it with: launchctl {unload,load -w} $PLIST_PATH"
echo "Logs: /tmp/hostess.log"
sleep 1
open "http://localhost:5300" 2>/dev/null || true
