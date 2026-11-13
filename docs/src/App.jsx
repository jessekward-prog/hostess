import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useScroll, useSpring, useTransform } from 'framer-motion';

const OS_DATA = {
  linux: {
    label: 'Linux',
    prompt: '$',
    meta: 'Debian / Ubuntu family // apt + user systemd service',
    sourceLabel: 'install.sh ↗',
    sourceUrl: 'https://github.com/jessekward-prog/hostess/blob/main/install.sh',
    cmd: '(command -v git >/dev/null 2>&1 || (sudo apt-get update -y && sudo apt-get install -y git)) && (git clone --depth 1 https://github.com/jessekward-prog/hostess.git ~/hostess || git -C ~/hostess pull --ff-only) && ~/hostess/install.sh',
    expectIntro: 'Mostly unattended. Every prompt on a clean Linux box:',
    expect: [
      { tag: 'STEP_01', html: 'Terminal asks for your <b>sudo password</b> once to install missing packages via <code>apt</code> and Docker\'s official repository.' },
      { tag: 'STEP_02', html: 'First run only: if Docker was just installed, log out and back in so your new <code>docker</code> group membership takes effect, then re-run the command.' },
      { tag: 'STEP_03', html: '<b>Ready</b> when it prints <code>http://localhost:5300</code> and opens the dashboard in your browser.' },
    ],
    setupHtml: 'Ensures Docker, Node.js 18+, <code>git</code>, and <code>curl</code> are installed. Clones to <code>~/hostess</code>, registers a user-level <code>hostess.service</code> with <code>loginctl enable-linger</code> so it survives reboot and logout, and adds an hourly <code>hostess-update.timer</code> that only restarts the server when a new commit lands on <code>main</code>.',
    manual: [
      {
        title: '01. Docker, Node.js 20, git',
        code: `sudo apt-get update -y && sudo apt-get install -y git curl ca-certificates
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"`,
      },
      {
        title: '02. Clone + install dependencies',
        code: `git clone --depth 1 https://github.com/jessekward-prog/hostess.git ~/hostess
cd ~/hostess && npm install --omit=dev`,
      },
      {
        title: '03. User systemd service',
        wide: true,
        code: `mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/hostess.service <<EOF
[Unit]
Description=Hostess dashboard
After=network.target docker.service

[Service]
WorkingDirectory=%h/hostess
ExecStart=$(command -v node) server.js
Restart=on-failure

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now hostess
loginctl enable-linger "$USER"`,
      },
      {
        title: '04. Service control',
        wide: true,
        code: `systemctl --user status  hostess
systemctl --user restart hostess
systemctl --user stop    hostess`,
      },
    ],
  },
  macos: {
    label: 'macOS',
    prompt: '%',
    meta: 'Apple Silicon or Intel // Homebrew + launchd agent',
    sourceLabel: 'install-macos.sh ↗',
    sourceUrl: 'https://github.com/jessekward-prog/hostess/blob/main/install-macos.sh',
    cmd: 'if ! xcode-select -p >/dev/null 2>&1; then xcode-select --install; echo "Approve the Command Line Tools dialog, then re-run this command."; else (git clone --depth 1 https://github.com/jessekward-prog/hostess.git ~/hostess || git -C ~/hostess pull --ff-only) && ~/hostess/install-macos.sh; fi',
    expectIntro: 'Works on Apple Silicon and Intel Macs. Prompts shown:',
    expect: [
      { tag: 'STEP_01', html: 'If macOS Command Line Tools aren\'t installed yet, macOS pops up an install dialog. Approve it, then re-run the command.' },
      { tag: 'STEP_02', html: 'Terminal asks for your <b>Mac login password</b> once for Homebrew and Docker Desktop installation.' },
      { tag: 'STEP_03', html: 'Docker Desktop\'s first launch shows a <b>permissions dialog</b>. Approve it (no Docker Hub account required), and your browser opens to <code>http://localhost:5300</code>.' },
    ],
    setupHtml: 'Installs Homebrew if missing, followed by <code>git</code>, <code>node</code>, and Docker Desktop. Clones to <code>~/hostess</code> and registers a <code>launchd</code> agent (<code>xyz.cmdward.hostess.plist</code>) with full Homebrew/Docker <code>PATH</code> plus an hourly update agent that only restarts when upstream commits change.',
    manual: [
      {
        title: '01. Homebrew, git, Node, Docker Desktop',
        code: `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install git node
brew install --cask docker
open -a Docker`,
      },
      {
        title: '02. Clone + install dependencies',
        code: `git clone --depth 1 https://github.com/jessekward-prog/hostess.git ~/hostess
cd ~/hostess && npm install --omit=dev`,
      },
      {
        title: '03. launchd agent',
        wide: true,
        code: `cat > ~/Library/LaunchAgents/xyz.cmdward.hostess.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>Label</key><string>xyz.cmdward.hostess</string>
  <key>ProgramArguments</key>
  <array><string>$(command -v node)</string><string>server.js</string></array>
  <key>WorkingDirectory</key><string>$HOME/hostess</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$HOME/.docker/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
</dict></plist>
EOF
launchctl load -w ~/Library/LaunchAgents/xyz.cmdward.hostess.plist`,
      },
      {
        title: '04. Service control',
        wide: true,
        code: `launchctl unload ~/Library/LaunchAgents/xyz.cmdward.hostess.plist
launchctl load -w ~/Library/LaunchAgents/xyz.cmdward.hostess.plist`,
      },
    ],
  },
  windows: {
    label: 'Windows',
    prompt: 'PS>',
    meta: 'Windows 10/11 PowerShell // winget + Scheduled Task (UAC)',
    sourceLabel: 'install.ps1 ↗',
    sourceUrl: 'https://github.com/jessekward-prog/hostess/blob/main/install.ps1',
    cmd: 'iwr -useb https://raw.githubusercontent.com/jessekward-prog/hostess/main/install.ps1 | iex',
    expectIntro: 'Paste into PowerShell (Start menu -> PowerShell):',
    expect: [
      { tag: 'STEP_01', html: 'A <b>UAC prompt</b> appears. Click Yes; a new elevated PowerShell window opens and runs the installation.' },
      { tag: 'STEP_02', html: 'If WSL2 was never enabled on this PC, it enables WSL2 and asks you to reboot once, then paste the same command again.' },
      { tag: 'STEP_03', html: 'Accept Docker Desktop\'s first-run license dialog (skip Docker Hub sign-in). Your browser opens to <code>http://localhost:5300</code> once Docker is ready.' },
    ],
    setupHtml: 'Installs <code>Git.Git</code>, <code>OpenJS.NodeJS.LTS</code> (18+), and <code>Docker.DockerDesktop</code> via <code>winget</code>. Clones to <code>$HOME\\hostess</code> and registers a logon Scheduled Task with automatic restart-on-failure plus an hourly update check.',
    manual: [
      {
        title: '01. git, Node.js LTS, Docker Desktop',
        code: `winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Docker.DockerDesktop -e`,
      },
      {
        title: '02. Enable WSL2',
        code: `wsl --install --no-distribution`,
      },
      {
        title: '03. Clone + install dependencies',
        code: `git clone --depth 1 https://github.com/jessekward-prog/hostess.git $HOME\\hostess
cd $HOME\\hostess
npm install --omit=dev`,
      },
      {
        title: '04. Scheduled Task',
        wide: true,
        code: `$action = New-ScheduledTaskAction -Execute "powershell.exe" \`
  -Argument '-NoProfile -WindowStyle Hidden -Command "while ($true) { Set-Location $HOME\\hostess; node server.js; Start-Sleep -Seconds 2 }"'
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
Register-ScheduledTask -TaskName hostess -Action $action -Trigger $trigger -Force
Start-ScheduledTask -TaskName hostess`,
      },
      {
        title: '05. Service control',
        wide: true,
        code: `Start-ScheduledTask -TaskName hostess
Stop-ScheduledTask  -TaskName hostess`,
      },
    ],
  },
};

const PRINCIPLES = [
  {
    code: '01 // BOOTSTRAP',
    title: 'Function Over Form',
    desc: 'Docker, Node 18+, git, and an auto-starting daemon provisioned in one repeatable shell pass.',
    icon: (
      <svg width="26" height="26" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.4">
        <polygon points="14,2 25,8.5 25,19.5 14,26 3,19.5 3,8.5" />
        <polyline points="3,8.5 14,15 25,8.5" />
        <line x1="14" y1="15" x2="14" y2="26" stroke="#005f00" />
      </svg>
    ),
  },
  {
    code: '02 // CONTRACTS',
    title: 'Systems Thinking',
    desc: 'Every repository declares its internal port, volume path, and backing needs cleanly in app.yaml.',
    icon: (
      <svg width="26" height="26" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.4">
        <rect x="3" y="3" width="22" height="22" />
        <rect x="8" y="8" width="12" height="12" stroke="#005f00" />
        <line x1="3" y1="14" x2="8" y2="14" /><line x1="20" y1="14" x2="25" y2="14" />
        <line x1="14" y1="3" x2="14" y2="8" /><line x1="14" y1="20" x2="14" y2="25" />
      </svg>
    ),
  },
  {
    code: '03 // ISOLATION',
    title: 'Segmented Nets',
    desc: 'Shared Postgres sits on selfhost-net while SearXNG and ntfy push run in isolated Docker fabrics.',
    icon: (
      <svg width="26" height="26" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.4">
        <circle cx="8" cy="8" r="4" /><circle cx="20" cy="8" r="4" stroke="#005f00" />
        <circle cx="14" cy="20" r="4" />
        <line x1="12" y1="8" x2="16" y2="8" /><line x1="9.5" y1="11.5" x2="12.5" y2="16.5" /><line x1="18.5" y1="11.5" x2="15.5" y2="16.5" />
      </svg>
    ),
  },
  {
    code: '04 // CONTRAST',
    title: 'Stable Redeploys',
    desc: 'Rebuilding the same app preserves its assigned host port, role credentials, and data volume.',
    icon: (
      <svg width="26" height="26" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.4">
        <circle cx="14" cy="14" r="9" />
        <line x1="14" y1="2" x2="14" y2="26" stroke="#005f00" />
        <line x1="2" y1="14" x2="26" y2="14" />
        <circle cx="14" cy="14" r="3" fill="#005f00" stroke="none" />
      </svg>
    ),
  },
  {
    code: '05 // ZERO_CLOUD',
    title: 'Raw & Local',
    desc: 'Loopback-only :5300 control plane, scrypt auth, Tailscale Private Link, and zero external telemetry.',
    icon: (
      <svg width="26" height="26" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="1.4">
        <rect x="4" y="4" width="5" height="5" /><rect x="19" y="4" width="5" height="5" stroke="#005f00" />
        <rect x="11.5" y="11.5" width="5" height="5" fill="#005f00" stroke="none" />
        <rect x="4" y="19" width="5" height="5" /><rect x="19" y="19" width="5" height="5" />
      </svg>
    ),
  },
];

const PLATFORM_MODULES = [
  {
    code: '01 // POSTGRES_CLUSTER',
    title: 'Shared Postgres',
    badge: 'postgres: true',
    bodyHtml: 'Creates an isolated SQL role and database on <code>selfhost-postgres</code> (<code>selfhost-net</code>) and injects both <code>DATABASE_URL</code> and discrete <code>DB_HOST</code>, <code>DB_PORT</code>, <code>DB_NAME</code>, <code>DB_USER</code>, and <code>DB_PASSWORD</code> variables.',
    art: (
      <svg width="100%" height="84" viewBox="0 0 240 84" fill="none">
        <rect x="14" y="14" width="64" height="56" stroke="#384034" strokeWidth="1" />
        <rect x="20" y="22" width="52" height="10" fill="#005f00" fillOpacity="0.85" />
        <rect x="20" y="38" width="52" height="8" fill="#242922" />
        <rect x="20" y="52" width="38" height="8" fill="#242922" />
        <line x1="78" y1="42" x2="152" y2="42" stroke="#005f00" strokeDasharray="4 3" />
        <polygon points="150,37 160,42 150,47" fill="#005f00" />
        <rect x="162" y="18" width="64" height="48" stroke="#005f00" strokeWidth="1.2" fill="#0b0d0b" />
        <line x1="162" y1="34" x2="226" y2="34" stroke="#384034" />
        <line x1="162" y1="50" x2="226" y2="50" stroke="#384034" />
      </svg>
    ),
  },
  {
    code: '02 // SEARCH_SEARXNG',
    title: 'Isolated Web Search',
    badge: 'search: true',
    bodyHtml: 'Provisions a shared SearXNG instance on a dedicated <code>hostess-search</code> network with zero DNS route to Postgres and injects <code>SEARXNG_URL</code> for private JSON queries.',
    art: (
      <svg width="100%" height="84" viewBox="0 0 240 84" fill="none">
        <circle cx="120" cy="42" r="30" stroke="#384034" strokeWidth="1" strokeDasharray="3 3" />
        <circle cx="120" cy="42" r="18" stroke="#005f00" strokeWidth="1.2" />
        <line x1="70" y1="42" x2="170" y2="42" stroke="#242922" />
        <line x1="120" y1="6" x2="120" y2="78" stroke="#242922" />
        <rect x="116" y="38" width="8" height="8" fill="#005f00" />
        <path d="M135 57 L154 74" stroke="#005f00" strokeWidth="2.2" />
      </svg>
    ),
  },
  {
    code: '03 // NEURAL_AI_LINK',
    title: 'Local AI Auto-Link',
    badge: 'AUTO-DETECT',
    bodyHtml: 'Scans JS/TS source for <code>LM_STUDIO_URL</code>, <code>LM_STUDIO_API_KEY</code>, and <code>LM_STUDIO_MODEL</code> and wires your MY AI library endpoint without editing <code>app.yaml</code>.',
    art: (
      <svg width="100%" height="84" viewBox="0 0 240 84" fill="none">
        <line x1="36" y1="22" x2="120" y2="42" stroke="#384034" />
        <line x1="36" y1="62" x2="120" y2="42" stroke="#005f00" />
        <line x1="120" y1="42" x2="204" y2="22" stroke="#005f00" />
        <line x1="120" y1="42" x2="204" y2="62" stroke="#384034" />
        <rect x="28" y="14" width="16" height="16" stroke="#9ea699" fill="#060706" />
        <rect x="28" y="54" width="16" height="16" stroke="#005f00" fill="#060706" />
        <polygon points="120,26 136,42 120,58 104,42" stroke="#005f00" fill="#121612" />
        <rect x="196" y="14" width="16" height="16" stroke="#005f00" fill="#005f00" fillOpacity="0.2" />
        <rect x="196" y="54" width="16" height="16" stroke="#9ea699" fill="#060706" />
      </svg>
    ),
  },
  {
    code: '04 // SIGNAL_NTFY_PUSH',
    title: 'Private Push Server',
    badge: 'TAILNET_ONLY',
    bodyHtml: 'Apps reading <code>NTFY_URL</code>, <code>NTFY_TOKEN</code>, and <code>NTFY_TOPIC</code> join <code>hostess-push</code>, a built-in <code>ntfy</code> relay published privately to your phone over Tailscale.',
    art: (
      <svg width="100%" height="84" viewBox="0 0 240 84" fill="none">
        <polyline points="16,46 58,46 72,22 86,66 102,16 118,58 134,36 146,46 224,46" stroke="#005f00" strokeWidth="1.6" />
        <line x1="16" y1="68" x2="224" y2="68" stroke="#242922" />
        <rect x="98" y="12" width="8" height="8" fill="#005f00" />
      </svg>
    ),
  },
  {
    code: '05 // GUARD_PREBUILD',
    title: 'Pre-Build Security Guard',
    badge: 'EVERY DEPLOY',
    bodyHtml: 'Before <code>docker build</code> starts, your local AI audits the target <code>Dockerfile</code>, <code>app.yaml</code>, and root entrypoint for privileged flags, remote shell pipes, or leaked secrets.',
    art: (
      <svg width="100%" height="84" viewBox="0 0 240 84" fill="none">
        <polygon points="120,10 156,22 152,54 120,74 88,54 84,22" stroke="#9ea699" strokeWidth="1.2" fill="#0b0d0b" />
        <polygon points="120,20 144,29 141,49 120,63 99,49 96,29" stroke="#005f00" strokeWidth="1.2" />
        <line x1="60" y1="42" x2="180" y2="42" stroke="#005f00" strokeOpacity="0.45" strokeDasharray="3 3" />
      </svg>
    ),
  },
  {
    code: '06 // FORGE_STUDIO',
    title: 'Forge & Marketplace',
    badge: 'BUILT IN',
    bodyHtml: 'Install curated apps from the Marketplace in one click, or describe a new app in <b>Forge</b> (<code>/forge.html</code>) to generate, preview in a sandboxed iframe, and deploy locally.',
    art: (
      <svg width="100%" height="84" viewBox="0 0 240 84" fill="none">
        <rect x="28" y="16" width="52" height="52" stroke="#384034" />
        <rect x="94" y="16" width="52" height="52" stroke="#005f00" fill="#121612" />
        <rect x="160" y="16" width="52" height="52" stroke="#384034" />
        <rect x="102" y="24" width="36" height="10" fill="#005f00" />
        <rect x="102" y="40" width="24" height="6" fill="#384034" />
        <rect x="102" y="52" width="30" height="6" fill="#384034" />
      </svg>
    ),
  },
];

const MANIFEST_FIELDS = [
  { key: 'name', val: 'my-app', desc: 'Lowercase letters, numbers, and hyphens (2 to 50 chars).' },
  { key: 'port', val: '3000', desc: 'Container port the app listens on (bind <code>0.0.0.0</code>, not localhost). Hostess does not inject <code>PORT</code>.' },
  { key: 'postgres', val: 'false', desc: 'Provisions an isolated role + database and injects <code>DATABASE_URL</code> + discrete <code>DB_*</code> vars.' },
  { key: 'search', val: 'false', desc: 'Attaches <code>hostess-search</code> and injects <code>SEARXNG_URL</code>.' },
  { key: 'autoUpdate', val: 'true', desc: 'Polls git remotes every ~10 minutes and redeploys automatically on new commits.' },
  { key: 'dataDir', val: '/app/data', desc: 'Absolute container path persisted across redeploys via a named Docker volume.' },
  { key: 'publicGateway', val: '{ port: 3001 }', desc: 'Optional narrow internal port for token-gated share links via <code>/run/hostess-gateway/url</code>.' },
  { key: 'env', val: '[]', desc: 'Extra env var names exposed on the dashboard card reveal panel (AI, <code>APP_PIN</code>, and <code>NTFY_*</code> auto-detected in JS/TS).' },
];

const TELEMETRY_BARS = [
  { label: 'CONTAINER_PORT', pct: 92, val: ':5300' },
  { label: 'POSTGRES_POOL', pct: 78, val: 'PG_16' },
  { label: 'GIT_AUTOPOLL', pct: 64, val: '10_MIN' },
  { label: 'LIVE_AI_SWAP', pct: 100, val: '/api/lm' },
];

const HECATE_BAYER8 = [
  [0,32,8,40,2,34,10,42],[48,16,56,24,50,18,58,26],
  [12,44,4,36,14,46,6,38],[60,28,52,20,62,30,54,22],
  [3,35,11,43,1,33,9,41],[51,19,59,27,49,17,57,25],
  [15,47,7,39,13,45,5,37],[63,31,55,23,61,29,53,21],
];
const HECATE_PROFILE_CROP = [40, 10, 480, 470];
const HECATE_PROFILE_POLY = [[190,20],[120,65],[92,150],[78,275],[95,400],[160,438],[300,442],[420,430],[472,235],[455,115],[360,40]];

const loadImage = (src) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.src = src;
});

function featherStatue(img, crop, w, filter, r, hold) {
  const h = Math.round(w * crop[3] / crop[2]);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.filter = filter;
  x.drawImage(img, crop[0], crop[1], crop[2], crop[3], 0, 0, w, h);
  x.filter = 'none';
  const g = x.createRadialGradient(w * 0.5, h * 0.5, 1, w * 0.5, h * 0.5, Math.max(w, h) * r);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(hold, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,1)');
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  return c;
}

function maskProfile(img, w) {
  const cr = HECATE_PROFILE_CROP;
  const s = document.createElement('canvas');
  s.width = cr[2]; s.height = cr[3];
  const sx = s.getContext('2d');
  sx.beginPath();
  HECATE_PROFILE_POLY.forEach((p, i) => {
    const x = p[0] - cr[0], y = p[1] - cr[1];
    i ? sx.lineTo(x, y) : sx.moveTo(x, y);
  });
  sx.closePath();
  sx.clip();
  sx.filter = 'grayscale(1) brightness(1.35) contrast(1.12)';
  sx.drawImage(img, cr[0], cr[1], cr[2], cr[3], 0, 0, cr[2], cr[3]);
  const h = Math.round(w * cr[3] / cr[2]);
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const x = out.getContext('2d');
  x.drawImage(s, 0, 0, w, h);
  const g = x.createLinearGradient(0, h * 0.7, 0, h);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,1)');
  x.fillStyle = g;
  x.fillRect(0, h * 0.7, w, h * 0.3);
  return out;
}

function composeHecate(imgs, W, H) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#000';
  x.fillRect(0, 0, W, H);
  const mid = featherStatue(imgs.front, [95, 265, 320, 410], 154, 'grayscale(1) brightness(0.95) contrast(1.1)', 0.62, 0.74);
  const right = featherStatue(imgs.quarter, [50, 335, 350, 420], 128, 'grayscale(1) brightness(0.98) contrast(1.15)', 0.6, 0.72);
  x.drawImage(maskProfile(imgs.profile, 140), -12, 66);
  x.drawImage(right, 224, 58);
  x.drawImage(mid, (W - mid.width) / 2, -4);
  const g = x.createLinearGradient(0, H - 58, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,1)');
  x.fillStyle = g;
  x.fillRect(0, H - 58, W, 58);
  return c;
}

const HecateMascot = ({ onMouseTelemetry }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const W = canvas.width, H = canvas.height;
    const ctx = canvas.getContext('2d');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let t = 0;
    let timer;
    let cancelled = false;

    Promise.all([
      loadImage('/mascot/hecate-front.png'),
      loadImage('/mascot/hecate-3q.png'),
      loadImage('/mascot/hecate-profile.png'),
    ]).then(([front, quarter, profile]) => {
      if (cancelled) return;
      const base = composeHecate({ front, quarter, profile }, W, H);
      const baseCtx = base.getContext('2d');
      const dot = document.createElement('canvas');
      dot.width = W; dot.height = H;
      const dctx = dot.getContext('2d');

      const tick = () => {
        t++;
        const flicker = !reduceMotion && t % 47 === 0;
        const gain = 1 + (flicker ? 0.35 : 0);
        const bias = -0.3 + (flicker ? 0.08 : 0);
        const phase = reduceMotion ? 0 : (t % 2) * 2;
        const d = baseCtx.getImageData(0, 0, W, H);
        const p = d.data;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            let l = (0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]) / 255;
            l = Math.min(1, Math.max(0, (l - 0.5) * gain + 0.5 + bias));
            const thr = (HECATE_BAYER8[(y + phase) & 7][(x + phase) & 7] + 0.5) / 64;
            const on = l > thr;
            p[i] = 235; p[i + 1] = 235; p[i + 2] = 235;
            p[i + 3] = on ? 255 : Math.round(255 * 0.58 * Math.max(0, l));
          }
        }
        dctx.putImageData(d, 0, 0);
        ctx.clearRect(0, 0, W, H);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(dot, 0, 0);
      };
      tick();
      if (!reduceMotion) timer = setInterval(tick, 110);
    });

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const handleMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width - 0.5;
    const ny = (e.clientY - rect.top) / rect.height - 0.5;
    onMouseTelemetry({
      x: (36.17 + nx * 12).toFixed(4),
      y: (-86.76 + ny * 12).toFixed(4),
      z: (5300 + nx * 40).toFixed(0),
    });
  };

  return (
    <div className="hero-right-canvas" onMouseMove={handleMove}>
      <canvas ref={canvasRef} width={340} height={250} className="hecate-canvas" />
    </div>
  );
};

export default function App() {
  const [os, setOs] = useState('linux');
  const [manualOpen, setManualOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState(null);
  const [activeField, setActiveField] = useState('name');
  const [coords, setCoords] = useState({ x: '127.0.0.1', y: 'PORT_5300', z: 'DOCKER_NET' });

  const { scrollYProgress } = useScroll();
  const smoothProgress = useSpring(scrollYProgress, { stiffness: 140, damping: 28, restDelta: 0.001 });
  const heroParallaxY = useTransform(scrollYProgress, [0, 0.3], [0, -32]);

  useEffect(() => {
    const ua = navigator.userAgent;
    if (/Windows/.test(ua)) setOs('windows');
    else if (/Mac OS X|Macintosh/.test(ua)) setOs('macos');
  }, []);


  const currentOS = OS_DATA[os];
  const currentFieldObj = MANIFEST_FIELDS.find((f) => f.key === activeField) || MANIFEST_FIELDS[0];

  const handleCopy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      setCopiedKey(null);
    }
  };

  return (
    <div className="cyber-bg">
      <motion.div className="scroll-progress" style={{ scaleX: smoothProgress }} />

      <div className="cyber-shell">
        <aside className="rail" aria-hidden="true">
          <span className="rail-cross">+</span>
          <span className="rail-vertical">2026 // SELF-HOSTED DOCKER PAAS // LOOPBACK :5300</span>
          <span className="rail-cross">+</span>
          <span className="rail-vertical">SYS_READY // NO_TELEMETRY</span>
          <span className="rail-cross">+</span>
        </aside>

        <div className="cyber-main">
          {/* ── /01 Hero Grid ── */}
          <section id="top" className="hero-grid">
            <div className="hero-left">
              <div>
                <motion.h1
                  className="cyber-title"
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                >
                  <span>SELF-HOSTED</span>
                  <span className="volt-accent">APP PLATFORM</span>
                </motion.h1>

                <div className="hero-sub-meta">
                  <span>/01 // ZERO-CLOUD INFRASTRUCTURE</span>
                  <span className="status-chip"><span className="sq" /> ONLINE :5300</span>
                </div>

                <motion.p
                  className="hero-manifesto"
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, delay: 0.08 }}
                >
                  THE FUTURE ISN&apos;T CLOUD RENT.<br />IT&apos;S SYSTEMATIC.
                </motion.p>

                <motion.p
                  className="hero-copy"
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, delay: 0.14 }}
                >
                  One command turns any clean Linux, macOS, or Windows machine into a Docker PaaS. Point Hostess at any repository with an <code>app.yaml</code> + <code>Dockerfile</code> and it builds, wires Postgres, SearXNG, local AI, and ntfy push automatically.
                </motion.p>
              </div>

              <div className="hero-actions">
                <a className="btn-volt" href="#section-install">
                  <span>INSTALL NOW</span>
                  <span>↘</span>
                </a>
                <a className="btn-outline" href="/rules.html">
                  <span>VIEW COMPLIANCE RULES</span>
                  <span>↗</span>
                </a>
                <a className="btn-outline" href="https://github.com/jessekward-prog/hostess" target="_blank" rel="noopener">
                  <span>GITHUB</span>
                  <span>↗</span>
                </a>
              </div>

              <div className="hero-barcode-strip" aria-hidden="true">
                <span className="rail-cross">+</span>
                <svg width="16" height="120" viewBox="0 0 16 120" fill="#9ea699">
                  <rect x="2" y="0" width="12" height="3" />
                  <rect x="2" y="7" width="12" height="1" />
                  <rect x="2" y="12" width="12" height="5" fill="#005f00" />
                  <rect x="2" y="21" width="12" height="2" />
                  <rect x="2" y="28" width="12" height="6" />
                  <rect x="2" y="38" width="12" height="1" />
                  <rect x="2" y="44" width="12" height="4" />
                  <rect x="2" y="53" width="12" height="2" fill="#005f00" />
                  <rect x="2" y="60" width="12" height="5" />
                  <rect x="2" y="70" width="12" height="1" />
                  <rect x="2" y="76" width="12" height="4" />
                  <rect x="2" y="85" width="12" height="2" />
                  <rect x="2" y="92" width="12" height="6" fill="#005f00" />
                  <rect x="2" y="103" width="12" height="3" />
                  <rect x="2" y="112" width="12" height="4" />
                </svg>
                <span className="mono" style={{ fontSize: 12, color: '#a0a89b' }}>/01</span>
              </div>
            </div>

            <div className="hero-right">
              <HecateMascot onMouseTelemetry={setCoords} />
              <div className="scanline-overlay" />

              <div className="hud-top">
                <div className="hud-readout">
                  <span>&gt; RENDERING_CORE...</span><br />
                  <span className="v">LOOPBACK // TAILSCALE // TUNNEL</span>
                </div>
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="#005f00" strokeWidth="1.2">
                  <circle cx="14" cy="14" r="11" />
                  <ellipse cx="14" cy="14" rx="5.5" ry="11" />
                  <line x1="3" y1="14" x2="25" y2="14" />
                </svg>
              </div>

              <motion.div className="hud-bottom" style={{ y: heroParallaxY }}>
                <span className="mono" style={{ fontSize: 12, color: '#a0a89b' }}>+ DOCKER_ENGINE</span>
                <div className="hud-coord-box">
                  <span>X_{coords.x}</span>
                  <span>Y_{coords.y}</span>
                  <span>Z_{coords.z}</span>
                </div>
                <span className="mono" style={{ fontSize: 12, color: '#f4f6f0' }}>//SCN_01</span>
              </motion.div>
            </div>
          </section>

          {/* ── /02 Core Principles (5 Columns with Scroll Stagger) ── */}
          <section id="section-principles">
            <div className="sec-bar">
              <div>
                <span className="num">/02</span>
                <span>CORE PRINCIPLES</span>
              </div>
              <span className="sub">+ SYSTEM ARCHITECTURE // 05 PILLARS</span>
            </div>

            <div className="principles-grid">
              {PRINCIPLES.map((p, idx) => (
                <motion.div
                  key={p.code}
                  className="principle-cell"
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.15 }}
                  transition={{ duration: 0.35, delay: idx * 0.06 }}
                >
                  <div className="principle-top">
                    <span style={{ color: '#f4f6f0' }}>{p.icon}</span>
                    <span className="principle-plus">+</span>
                  </div>
                  <div>
                    <div className="mono" style={{ fontSize: 12, color: '#005f00', marginBottom: 4 }}>{p.code}</div>
                    <h2 className="principle-title">{p.title}</h2>
                  </div>
                  <p className="principle-desc">{p.desc}</p>
                </motion.div>
              ))}
            </div>
          </section>

          {/* ── /03 Multi-OS Install Terminal Matrix ── */}
          <section id="section-install" className="install-section">
            <div className="sec-bar">
              <div>
                <span className="num">/03</span>
                <span>INSTALL_TERMINAL // MULTI-OS BOOTSTRAP</span>
              </div>
              <span className="sub">SAFE TO RE-RUN ON EXISTING CHECKOUTS</span>
            </div>

            <div className="os-bar">
              <div className="os-tabs" role="tablist" aria-label="Target operating system">
                {Object.entries(OS_DATA).map(([key, item]) => {
                  const active = os === key;
                  return (
                    <button
                      key={key}
                      id={`os-tab-${key}`}
                      className={`os-tab ${active ? 'active' : ''}`}
                      onClick={() => setOs(key)}
                      role="tab"
                      aria-selected={active}
                    >
                      <span className="os-tab-label">{item.label}</span>
                      {active && (
                        <motion.div
                          layoutId="cyber-os-pill"
                          className="os-pill-ring"
                          transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
              <span className="os-meta-text">{currentOS.meta}</span>
            </div>

            <div className="install-split">
              <motion.div
                className="install-cmd-pane"
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.15 }}
                transition={{ duration: 0.35 }}
              >
                <div>
                  <div className="pane-kicker">ONE-COMMAND BOOTSTRAP ({currentOS.label.toUpperCase()})</div>
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={os}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 6 }}
                      transition={{ duration: 0.16 }}
                      className="cmd-box"
                    >
                      <span className="cmd-prompt">{currentOS.prompt}</span>
                      <pre className="cmd-text">{currentOS.cmd}</pre>
                    </motion.div>
                  </AnimatePresence>
                </div>

                <div className="cmd-bar-actions">
                  <button
                    className="btn-volt"
                    onClick={() => handleCopy(currentOS.cmd, 'install-main')}
                  >
                    <span>{copiedKey === 'install-main' ? 'COPIED TO CLIPBOARD' : 'COPY INSTALL COMMAND'}</span>
                    <span>↗</span>
                  </button>
                  <a className="cmd-source-link" href={currentOS.sourceUrl} target="_blank" rel="noopener">
                    VIEW SOURCE: {currentOS.sourceLabel}
                  </a>
                </div>
              </motion.div>

              <motion.div
                className="install-expect-pane"
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.15 }}
                transition={{ duration: 0.35, delay: 0.08 }}
              >
                <div>
                  <div className="pane-kicker">WHAT TO EXPECT</div>
                  <p style={{ fontSize: 12.5, color: '#9ea699', marginBottom: 12 }}>{currentOS.expectIntro}</p>
                  <ul className="expect-steps">
                    {currentOS.expect.map((step) => (
                      <li key={step.tag}>
                        <span className="step-num">{step.tag}</span>
                        <span dangerouslySetInnerHTML={{ __html: step.html }} />
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="setup-summary">
                  <div className="pane-kicker">WHAT IT SETS UP</div>
                  <p dangerouslySetInnerHTML={{ __html: currentOS.setupHtml }} />
                </div>
              </motion.div>
            </div>

            <button
              id="drawer-btn-manual"
              className="manual-trigger"
              onClick={() => setManualOpen((prev) => !prev)}
            >
              <span>[ {manualOpen ? '-' : '+'} MANUAL PROTOCOL // STEP-BY-STEP COMMANDS ({currentOS.manual.length} BLOCKS) ]</span>
              <span>{manualOpen ? 'COLLAPSE ▲' : 'EXPAND ▼'}</span>
            </button>

            <AnimatePresence initial={false}>
              {manualOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
                  className="manual-drawer-wrap"
                >
                  <div className="manual-grid">
                    {currentOS.manual.map((block, idx) => {
                      const key = `${os}-manual-${idx}`;
                      return (
                        <div key={block.title} className={`manual-card ${block.wide ? 'wide' : ''}`}>
                          <div className="manual-card-head">
                            <span className="manual-card-title">{block.title}</span>
                            <button
                              className={`mini-copy-btn ${copiedKey === key ? 'copied' : ''}`}
                              onClick={() => handleCopy(block.code, key)}
                            >
                              {copiedKey === key ? 'COPIED' : 'COPY'}
                            </button>
                          </div>
                          <pre className="manual-code">{block.code}</pre>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>

          {/* ── /04 Platform Modules (6-Card Brutalist Grid) ── */}
          <section id="section-modules">
            <div className="sec-bar">
              <div>
                <span className="num">/04</span>
                <span>PLATFORM MODULES // AUTO-WIRED SERVICES</span>
              </div>
              <span className="sub">PROVISIONED AUTOMATICALLY AT DEPLOY TIME</span>
            </div>

            <div className="modules-grid">
              {PLATFORM_MODULES.map((mod, idx) => (
                <motion.article
                  key={mod.code}
                  className="module-card"
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.12 }}
                  transition={{ duration: 0.36, delay: (idx % 3) * 0.08 }}
                >
                  <div className="module-visual">
                    <span className="module-visual-tag">{mod.badge}</span>
                    {mod.art}
                  </div>
                  <div className="module-body">
                    <div className="mono" style={{ fontSize: 12, color: '#a0a89b' }}>{mod.code}</div>
                    <div className="module-head">
                      <h3 className="module-title">{mod.title}</h3>
                      <span className="module-arrow">↗</span>
                    </div>
                    <p className="module-desc" dangerouslySetInnerHTML={{ __html: mod.bodyHtml }} />
                  </div>
                </motion.article>
              ))}
            </div>
          </section>

          {/* ── /05–/07 Bottom Brutalist Deck ── */}
          <section id="section-manifest" className="deck-grid">
            {/* /05 APP.YAML SCHEMA */}
            <motion.div
              className="deck-col"
              initial={{ opacity: 0, y: 22 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.12 }}
              transition={{ duration: 0.36 }}
            >
              <div className="mono" style={{ fontSize: 12, color: '#005f00', fontWeight: 700 }}>/05</div>
              <h2 className="deck-heading">APP.YAML<br />CONTRACT</h2>
              <p style={{ fontSize: 14, color: '#a0a89b' }}>
                Every repository root requires <code>app.yaml</code> + <code>Dockerfile</code>. Select any key below to inspect behavior:
              </p>

              <div className="yaml-interactive">
                {MANIFEST_FIELDS.map((f) => (
                  <div
                    key={f.key}
                    className={`yaml-row ${activeField === f.key ? 'active' : ''}`}
                    onMouseEnter={() => setActiveField(f.key)}
                    onClick={() => setActiveField(f.key)}
                  >
                    <span className="k">{f.key}:</span>
                    <span className="v">{f.val}</span>
                  </div>
                ))}
              </div>

              <div className="yaml-detail-box">
                <strong>FIELD // {currentFieldObj.key}</strong>
                <span dangerouslySetInnerHTML={{ __html: currentFieldObj.desc }} />
              </div>
            </motion.div>

            {/* /06 SYSTEM TELEMETRY & DEPLOY CLI */}
            <motion.div
              className="deck-col"
              initial={{ opacity: 0, y: 22 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.12 }}
              transition={{ duration: 0.36, delay: 0.08 }}
            >
              <div className="mono" style={{ fontSize: 12, color: '#005f00', fontWeight: 700 }}>/06</div>
              <h2 className="deck-heading">SYSTEM STATUS &amp;<br />DEPLOY CLI</h2>

              <div className="telemetry-rows">
                {TELEMETRY_BARS.map((bar, idx) => (
                  <div key={bar.label} className="tele-row">
                    <span className="tele-label">{bar.label}</span>
                    <div className="tele-track">
                      <motion.div
                        className="tele-fill"
                        initial={{ width: '0%' }}
                        whileInView={{ width: `${bar.pct}%` }}
                        viewport={{ once: true, amount: 0 }}
                        transition={{ duration: 0.55, delay: idx * 0.08, ease: [0.22, 1, 0.36, 1] }}
                      />
                    </div>
                    <span className="tele-val">{bar.val}</span>
                  </div>
                ))}
              </div>

              <div>
                <div className="pane-kicker">CLI DEPLOY TARGETS (:5300 DASHBOARD OR CLI)</div>
                <pre className="manual-code">{`node deploy.js https://github.com/you/your-app
node deploy.js /path/to/local/repo`}</pre>
              </div>

              <p style={{ fontSize: 14, color: '#a0a89b', lineHeight: 1.55 }}>
                Redeploying the same app reuses its host port, container name, persistent <code>dataDir</code> volume, and Postgres role password. Apps implementing <code>GET/PUT /api/lm</code> (with <code>SYNC_SECRET</code>) get live model switching on their card.
              </p>

              <div className="operational-banner">
                ALL SYSTEMS OPERATIONAL // LOOPBACK 127.0.0.1:5300
              </div>
            </motion.div>

            {/* /07 COMPLIANCE PROMPT FOR AI */}
            <motion.div
              className="deck-col"
              initial={{ opacity: 0, y: 22 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.12 }}
              transition={{ duration: 0.36, delay: 0.16 }}
            >
              <div className="mono" style={{ fontSize: 12, color: '#005f00', fontWeight: 700 }}>/07</div>
              <h2 className="deck-heading">COMPLIANCE<br />PROMPT FOR AI</h2>
              <p style={{ fontSize: 14, color: '#a0a89b', lineHeight: 1.6 }}>
                Making an existing repo Hostess-ready? Open the compliance specification and copy the AI agent audit prompt to validate Dockerfile, <code>PORT</code>, Postgres SSL, PIN gates, and graceful <code>SIGTERM</code> shutdown.
              </p>

              <a className="btn-volt" href="/rules.html" style={{ justifyContent: 'space-between' }}>
                <span>OPEN COMPLIANCE PROMPT</span>
                <span>↗</span>
              </a>

              <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: '#9ea699', borderTop: '1px solid var(--grid)', paddingTop: 12 }}>
                ZERO TELEMETRY // RUNS LOCALLY<br />
                SELF-HOSTED BY DEFAULT
              </div>

              <div className="slash-pattern" aria-hidden="true" />
            </motion.div>
          </section>

          {/* ── Brutalist Footer & Hazard Tape ── */}
          <footer className="cyber-footer">
            <div className="foot-col">
              <div className="mono" style={{ fontSize: 14, fontWeight: 800, color: '#f4f6f0' }}>HOSTESS_</div>
              <span className="meta-val">Self-hosted Docker app platform.</span>
              <span className="meta-val">Loopback :5300 // Tailscale // Quick Tunnel</span>
            </div>
            <div className="foot-col">
              <div className="foot-col-head">NAVIGATION</div>
              <a href="#top">/01 Overview</a>
              <a href="#section-principles">/02 Core Principles</a>
              <a href="#section-install">/03 Install Matrix</a>
              <a href="#section-modules">/04 Platform Modules</a>
            </div>
            <div className="foot-col">
              <div className="foot-col-head">SPECS &amp; RULES</div>
              <a href="#section-manifest">/05 app.yaml Schema</a>
              <a href="#section-manifest">/06 Deploy CLI &amp; /api/lm</a>
              <a href="/rules.html">/07 Compliance AI Prompt ↗</a>
            </div>
            <div className="foot-col">
              <div className="foot-col-head">SOURCE_NODE</div>
              <a href="https://github.com/jessekward-prog/hostess" target="_blank" rel="noopener">GitHub Repo ↗</a>
              <a href="https://github.com/jessekward-prog/hostess/blob/main/install.sh" target="_blank" rel="noopener">install.sh ↗</a>
              <a href="https://github.com/jessekward-prog/hostess/blob/main/install-macos.sh" target="_blank" rel="noopener">install-macos.sh ↗</a>
              <a href="https://github.com/jessekward-prog/hostess/blob/main/install.ps1" target="_blank" rel="noopener">install.ps1 ↗</a>
            </div>
          </footer>

          <div className="hazard-strip">
            <span className="hazard-label">&gt; ACCESS GRANTED_ // HOSTESS SELF-HOSTED PAAS</span>
          </div>
        </div>

        <aside className="rail rail-right" aria-hidden="true">
          <span className="rail-cross">✕</span>
          <span className="rail-vertical">POSTGRES // SEARXNG // NTFY // LM_STUDIO</span>
          <span className="rail-cross">+</span>
          <span className="rail-vertical">HOSTESS.CMDWARD.XYZ</span>
          <span className="rail-cross">+</span>
        </aside>
      </div>
    </div>
  );
}
