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

# --- Xcode Command Line Tools (git is a stub that GUI-prompts without them) ---
if ! xcode-select -p >/dev/null 2>&1; then
  echo "Command Line Tools aren't installed yet — a macOS dialog is about to open." >&2
  xcode-select --install >/dev/null 2>&1 || true
  echo "Approve that dialog, wait for the install to finish, then re-run this script." >&2
  exit 1
fi

# --- Homebrew ---
if ! command -v brew >/dev/null 2>&1; then
  echo "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
# Run every time (not just on fresh install) so this script's PATH always
# prefers Homebrew's bin over any older/system node, git, etc. on PATH.
eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"

# --- prerequisites ---
if ! command -v git >/dev/null 2>&1; then
  echo "Installing git..."
  brew install git
fi

NODE_MAJOR=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -v | sed 's/^v//;s/\..*//')"
fi
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Installing Node.js via Homebrew..."
  brew install node
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Installing Docker Desktop..."
  brew install --cask docker
fi

if ! docker info >/dev/null 2>&1; then
  echo "Starting Docker Desktop..."
  open -a Docker 2>/dev/null || open -a "Docker Desktop" 2>/dev/null || open /Applications/Docker.app 2>/dev/null || true
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
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${HOME}/.docker/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
EOF

UPDATE_PLIST_LABEL="xyz.cmdward.hostess-update"
UPDATE_PLIST_PATH="$HOME/Library/LaunchAgents/${UPDATE_PLIST_LABEL}.plist"

cat > "$UPDATE_PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${UPDATE_PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>git -C '${INSTALL_DIR}' pull --ff-only &amp;&amp; npm --prefix '${INSTALL_DIR}' install --omit=dev &amp;&amp; launchctl kickstart -k gui/\$(id -u)/xyz.cmdward.hostess</string>
  </array>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><false/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${HOME}/.docker/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict>
</plist>
EOF

launchctl unload "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl load -w "$PLIST_PATH"
launchctl unload "$UPDATE_PLIST_PATH" >/dev/null 2>&1 || true
launchctl load -w "$UPDATE_PLIST_PATH"

echo ""
echo "hostess is running at http://localhost:5300"
echo "Manage it with: launchctl {unload,load -w} $PLIST_PATH"
echo "Logs: /tmp/hostess.log"
sleep 1
open "http://localhost:5300" 2>/dev/null || true
