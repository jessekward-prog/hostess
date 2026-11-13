import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const OS_DATA = {
  linux: {
    label: 'Linux',
    accent: '#3fb37f',
    tint: 'rgba(63,179,127,0.42)',
    prompt: '$',
    meta: 'Debian / Ubuntu family · apt + user systemd service',
    barTitle: 'Quick install (Bash)',
    barSub: 'Installs git if missing, clones to ~/hostess, runs install.sh',
    sourceLabel: 'install.sh ↗',
    sourceUrl: 'https://github.com/jessekward-prog/hostess/blob/main/install.sh',
    cmd: '(command -v git >/dev/null 2>&1 || (sudo apt-get update -y && sudo apt-get install -y git)) && (git clone --depth 1 https://github.com/jessekward-prog/hostess.git ~/hostess || git -C ~/hostess pull --ff-only) && ~/hostess/install.sh',
    expectIntro: 'Mostly unattended. Here is every prompt you will see on a clean machine:',
    expect: [
      { tag: 'Step 01', html: 'Terminal asks for your <b>sudo password</b> once to install missing packages via <code>apt</code> and Docker\'s official repository.' },
      { tag: 'Step 02', html: 'First run only: if Docker was just installed, log out and back in so your new <code>docker</code> group membership takes effect, then re-run the command.' },
      { tag: 'Step 03', html: '<b>Ready</b> when it prints <code>http://localhost:5300</code> and opens the dashboard in your browser.' },
    ],
    setupHtml: 'Ensures Docker, Node.js 18+, <code>git</code>, and <code>curl</code> are installed. Clones to <code>~/hostess</code>, registers a user-level <code>hostess.service</code> with <code>loginctl enable-linger</code> so it survives reboot and logout, and adds an hourly <code>hostess-update.timer</code> that only restarts the server when a new commit lands on <code>main</code>.',
    manual: [
      {
        title: '1. Docker, Node.js 20, git',
        code: `sudo apt-get update -y && sudo apt-get install -y git curl ca-certificates
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"`,
      },
      {
        title: '2. Clone + install dependencies',
        code: `git clone --depth 1 https://github.com/jessekward-prog/hostess.git ~/hostess
cd ~/hostess && npm install --omit=dev`,
      },
      {
        title: '3. User systemd service',
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
        title: '4. Service control',
        wide: true,
        code: `systemctl --user status  hostess
systemctl --user restart hostess
systemctl --user stop    hostess`,
      },
    ],
  },
  macos: {
    label: 'macOS',
    accent: '#e0559c',
    tint: 'rgba(224,85,156,0.42)',
    prompt: '%',
    meta: 'Apple Silicon or Intel · Homebrew + launchd agent',
    barTitle: 'Quick install (macOS)',
    barSub: 'Checks Xcode CLI Tools, clones to ~/hostess, runs install-macos.sh',
    sourceLabel: 'install-macos.sh ↗',
    sourceUrl: 'https://github.com/jessekward-prog/hostess/blob/main/install-macos.sh',
    cmd: 'if ! xcode-select -p >/dev/null 2>&1; then xcode-select --install; echo "Approve the Command Line Tools dialog, then re-run this command."; else (git clone --depth 1 https://github.com/jessekward-prog/hostess.git ~/hostess || git -C ~/hostess pull --ff-only) && ~/hostess/install-macos.sh; fi',
    expectIntro: 'Works on Apple Silicon and Intel Macs. Here is what it asks of you:',
    expect: [
      { tag: 'Step 01', html: 'If macOS Command Line Tools aren\'t installed yet, macOS pops up an install dialog. Approve it, then re-run the command.' },
      { tag: 'Step 02', html: 'Terminal asks for your <b>Mac login password</b> once for Homebrew and Docker Desktop installation.' },
      { tag: 'Step 03', html: 'Docker Desktop\'s first launch shows a <b>permissions dialog</b>. Approve it (no Docker Hub account required), and your browser opens to <code>http://localhost:5300</code>.' },
    ],
    setupHtml: 'Installs Homebrew if missing, followed by <code>git</code>, <code>node</code>, and Docker Desktop. Clones to <code>~/hostess</code> and registers a <code>launchd</code> agent (<code>xyz.cmdward.hostess.plist</code>) with full Homebrew/Docker <code>PATH</code> plus an hourly update agent that only restarts when upstream commits change.',
    manual: [
      {
        title: '1. Homebrew, git, Node, Docker Desktop',
        code: `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install git node
brew install --cask docker
open -a Docker`,
      },
      {
        title: '2. Clone + install dependencies',
        code: `git clone --depth 1 https://github.com/jessekward-prog/hostess.git ~/hostess
cd ~/hostess && npm install --omit=dev`,
      },
      {
        title: '3. launchd agent',
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
        title: '4. Service control',
        wide: true,
        code: `launchctl unload ~/Library/LaunchAgents/xyz.cmdward.hostess.plist
launchctl load -w ~/Library/LaunchAgents/xyz.cmdward.hostess.plist`,
      },
    ],
  },
  windows: {
    label: 'Windows',
    accent: '#4f8fe0',
    tint: 'rgba(79,143,224,0.42)',
    prompt: 'PS>',
    meta: 'Windows 10/11 PowerShell · winget + Scheduled Task (UAC)',
    barTitle: 'Quick install (PowerShell)',
    barSub: 'Self-elevates via UAC, installs prerequisites via winget, starts Hostess',
    sourceLabel: 'install.ps1 ↗',
    sourceUrl: 'https://github.com/jessekward-prog/hostess/blob/main/install.ps1',
    cmd: 'iwr -useb https://raw.githubusercontent.com/jessekward-prog/hostess/main/install.ps1 | iex',
    expectIntro: 'Paste into any PowerShell window (Start menu, type "PowerShell"):',
    expect: [
      { tag: 'Step 01', html: 'A <b>UAC prompt</b> appears. Click Yes; a new elevated PowerShell window opens and runs the installation.' },
      { tag: 'Step 02', html: 'If WSL2 was never enabled on this PC, it enables WSL2 and asks you to reboot once, then paste the same command again.' },
      { tag: 'Step 03', html: 'Accept Docker Desktop\'s first-run license dialog (skip Docker Hub sign-in). Your browser opens to <code>http://localhost:5300</code> once Docker is ready.' },
    ],
    setupHtml: 'Installs <code>Git.Git</code>, <code>OpenJS.NodeJS.LTS</code> (18+), and <code>Docker.DockerDesktop</code> via <code>winget</code>. Clones to <code>$HOME\\hostess</code> and registers a logon Scheduled Task with automatic restart-on-failure plus an hourly update check.',
    manual: [
      {
        title: '1. git, Node.js LTS, Docker Desktop',
        code: `winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Docker.DockerDesktop -e`,
      },
      {
        title: '2. Enable WSL2',
        code: `wsl --install --no-distribution`,
      },
      {
        title: '3. Clone + install dependencies',
        code: `git clone --depth 1 https://github.com/jessekward-prog/hostess.git $HOME\\hostess
cd $HOME\\hostess
npm install --omit=dev`,
      },
      {
        title: '4. Scheduled Task',
        wide: true,
        code: `$action = New-ScheduledTaskAction -Execute "powershell.exe" \`
  -Argument '-NoProfile -WindowStyle Hidden -Command "while ($true) { Set-Location $HOME\\hostess; node server.js; Start-Sleep -Seconds 2 }"'
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
Register-ScheduledTask -TaskName hostess -Action $action -Trigger $trigger -Force
Start-ScheduledTask -TaskName hostess`,
      },
      {
        title: '5. Service control',
        wide: true,
        code: `Start-ScheduledTask -TaskName hostess
Stop-ScheduledTask  -TaskName hostess`,
      },
    ],
  },
};

const PLATFORM_SERVICES = [
  {
    id: 'postgres',
    title: 'Shared Postgres',
    summary: 'Isolated role + database per app on selfhost-postgres',
    badge: 'postgres: true',
    auto: false,
    bodyHtml: 'Creates an isolated SQL role and database on <code>selfhost-postgres</code> (<code>selfhost-net</code>) and injects both <code>DATABASE_URL</code> and discrete <code>DB_HOST</code>, <code>DB_PORT</code>, <code>DB_NAME</code>, <code>DB_USER</code>, and <code>DB_PASSWORD</code> variables. Redeploys reuse the existing role password.',
  },
  {
    id: 'search',
    title: 'Isolated Web Search',
    summary: 'Dedicated SearXNG container isolated from your database',
    badge: 'search: true',
    auto: false,
    bodyHtml: 'Provisions a shared SearXNG instance on a dedicated <code>hostess-search</code> network (no route to Postgres) and injects <code>SEARXNG_URL</code> for JSON search queries.',
  },
  {
    id: 'ai',
    title: 'Local AI Auto-Link',
    summary: 'Auto-injects LM_STUDIO_URL, key, and model from MY AI',
    badge: 'Auto-detected',
    auto: true,
    bodyHtml: 'Scans JS/TS source for <code>LM_STUDIO_URL</code>, <code>LM_STUDIO_API_KEY</code>, and <code>LM_STUDIO_MODEL</code> and injects your MY AI library endpoint automatically without editing <code>app.yaml</code>.',
  },
  {
    id: 'push',
    title: 'Private Push Server',
    summary: 'Built-in ntfy server published over Tailscale',
    badge: 'Auto-detected',
    auto: true,
    bodyHtml: 'Apps reading <code>NTFY_URL</code>, <code>NTFY_TOKEN</code>, and <code>NTFY_TOPIC</code> are joined to <code>hostess-push</code>, a built-in <code>ntfy</code> server published privately to your phone over Tailscale.',
  },
  {
    id: 'guard',
    title: 'Pre-Build Security Guard',
    summary: 'Audits Dockerfile, app.yaml, and entrypoint before build',
    badge: 'Every deploy',
    auto: true,
    bodyHtml: 'Before <code>docker build</code> runs, your local AI reviews the repo\'s <code>Dockerfile</code>, <code>app.yaml</code>, and entrypoint for privileged flags, remote script execution, or exposed secrets.',
  },
  {
    id: 'forge',
    title: 'Forge & Marketplace',
    summary: 'One-click curated apps + local AI app builder',
    badge: 'Built in',
    auto: false,
    bodyHtml: 'Install curated apps from the Marketplace in one click, or describe a new app in <b>Forge</b> (<code>/forge.html</code>) to generate, test-drive, and deploy it locally.',
  },
];

const MANIFEST_FIELDS = [
  { key: 'name', val: 'my-app', desc: 'Lowercase letters, numbers, and hyphens (2 to 50 chars).' },
  { key: 'port', val: '3000', desc: 'Container port the app listens on (bind <code>0.0.0.0</code>, not localhost). Hostess does not inject <code>PORT</code>.' },
  { key: 'postgres', val: 'false', desc: 'Provisions a role + database and injects <code>DATABASE_URL</code> + <code>DB_*</code>.' },
  { key: 'search', val: 'false', desc: 'Attaches <code>hostess-search</code> and injects <code>SEARXNG_URL</code>.' },
  { key: 'autoUpdate', val: 'true', desc: 'Polls git remotes every 10 minutes and redeploys on new commits.' },
  { key: 'dataDir', val: '/app/data', desc: 'Absolute container path persisted across redeploys in a named Docker volume.' },
  { key: 'publicGateway', val: '{ port: 3001 }', desc: 'Optional narrow internal port for token-gated share links via <code>/run/hostess-gateway/url</code>.' },
  { key: 'env', val: '[]', desc: 'Extra env var names exposed on the card\'s reveal panel (AI, <code>APP_PIN</code>, and <code>NTFY_*</code> are auto-detected in JS/TS).' },
];

const VIEW_VARIANTS = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.2, ease: [0.23, 1, 0.32, 1] } },
  exit: { opacity: 0, y: -5, transition: { duration: 0.12 } },
};

export default function App() {
  const [view, setView] = useState('install'); // 'install' | 'platform' | 'deploy'
  const [os, setOs] = useState('linux');
  const [drawer, setDrawer] = useState(null); // null | 'expect' | 'setup' | 'manual'
  const [copied, setCopied] = useState(false);
  const [openService, setOpenService] = useState('postgres');
  const [deployTab, setDeployTab] = useState('schema'); // 'schema' | 'cli' | 'lifecycle'
  const [activeField, setActiveField] = useState('name');
  const [menuOpen, setMenuOpen] = useState(false);
  const sidebarRef = useRef(null);

  useEffect(() => {
    const ua = navigator.userAgent;
    if (/Windows/.test(ua)) setOs('windows');
    else if (/Mac OS X|Macintosh/.test(ua)) setOs('macos');
  }, []);

  useEffect(() => {
    const el = sidebarRef.current;
    if (!el) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;';
    el.prepend(canvas);
    const ctx = canvas.getContext('2d');
    const A = [232, 132, 10];
    const steel = '120,90,180';
    const parts = Array.from({ length: 18 }, () => ({
      x: Math.random(), y: Math.random(), r: 0.4 + Math.random() * 1.2, s: 0.02 + Math.random() * 0.05,
    }));
    const bands = [
      { amp: 40, len: 0.9, sp: 0.18, y: 0.5, a: 0.06, tint: true },
      { amp: 65, len: 0.6, sp: 0.12, y: 0.6, a: 0.05, tint: true },
      { amp: 85, len: 0.4, sp: 0.08, y: 0.7, a: 0.035, tint: false },
    ];
    let t = 0;
    let raf;
    const size = () => {
      const d = window.devicePixelRatio || 1;
      canvas.width = el.clientWidth * d;
      canvas.height = el.clientHeight * d;
      ctx.setTransform(d, 0, 0, d, 0, 0);
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);
    const draw = () => {
      t += reduceMotion ? 0.0005 : 0.001;
      const W = el.clientWidth, H = el.clientHeight;
      ctx.clearRect(0, 0, W, H);
      bands.forEach((b) => {
        ctx.beginPath();
        for (let x = 0; x <= W; x += 8) {
          const p = x / W;
          const y = H * b.y + Math.sin(p * 6.28 * b.len + t / b.sp) * b.amp + Math.sin(p * 15.7 * b.len - (t / b.sp) * 1.7) * b.amp * 0.3;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        const c = b.tint ? `${A[0]},${A[1]},${A[2]}` : steel;
        ctx.strokeStyle = `rgba(${c},${Math.min(b.a * 5, 0.9)})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
      parts.forEach((p) => {
        p.y -= p.s * 0.002;
        if (p.y < -0.02) { p.y = 1.02; p.x = Math.random(); }
        ctx.beginPath();
        ctx.arc(p.x * W, p.y * H, p.r, 0, 6.28);
        ctx.fillStyle = `rgba(${A[0]},${A[1]},${A[2]},0.15)`;
        ctx.fill();
      });
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); canvas.remove(); };
  }, []);

  const currentOS = OS_DATA[os];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(currentOS.cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const switchView = (next) => {
    setView(next);
    setMenuOpen(false);
  };

  return (
    <div className="shell" style={{ '--os-accent': currentOS.accent, '--os-tint': currentOS.tint }}>
      <motion.button
        whileTap={{ scale: 0.95 }}
        className="menu-btn"
        onClick={() => setMenuOpen(true)}
        aria-label="Open navigation menu"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </motion.button>
      <div className={`sidebar-backdrop ${menuOpen ? 'open' : ''}`} onClick={() => setMenuOpen(false)} />

      <aside className={`sidebar ${menuOpen ? 'open' : ''}`} ref={sidebarRef}>
        <div className="sidebar-content">
          <div className="brand-row">
            <div className="brand" onClick={() => switchView('install')}>
              <span className="mark">
                <svg width="15" height="15" viewBox="0 0 100 100" fill="none"><circle cx="50" cy="50" r="42" stroke="#fff" strokeWidth="6"/><g stroke="#fff" strokeWidth="6" strokeLinecap="round"><path d="M50,41 C56,30 68,33 68,22 C68,13 59,9 51,13 C45,16 46,22 52,23"/><path d="M50,41 C56,30 68,33 68,22 C68,13 59,9 51,13 C45,16 46,22 52,23" transform="rotate(120,50,50)"/><path d="M50,41 C56,30 68,33 68,22 C68,13 59,9 51,13 C45,16 46,22 52,23" transform="rotate(240,50,50)"/></g><circle cx="50" cy="50" r="8" stroke="#fff" strokeWidth="4.4"/><g stroke="#fff" strokeWidth="4.4" strokeLinecap="round"><line x1="50" y1="44" x2="50" y2="56"/><line x1="50" y1="44" x2="50" y2="56" transform="rotate(60,50,50)"/><line x1="50" y1="44" x2="50" y2="56" transform="rotate(120,50,50)"/></g></svg>
              </span>
              <div>
                <span className="brand-title">Hostess</span>
                <span className="brand-sub">self-hosted paas</span>
              </div>
            </div>
            <button className="drawer-close" onClick={() => setMenuOpen(false)} aria-label="Close navigation menu">✕</button>
          </div>

          <nav className="sidebar-nav">
            <span className="section-label">Workspace</span>

            {[
              { id: 'install', label: 'Install', badge: currentOS.label, icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg> },
              { id: 'platform', label: 'Platform Services', badge: '6', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg> },
              { id: 'deploy', label: 'app.yaml & Deploy', badge: '8', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.3 7 12 12 20.7 7"/><line x1="12" y1="22" x2="12" y2="12"/></svg> },
            ].map((item) => {
              const active = view === item.id;
              return (
                <button
                  key={item.id}
                  id={`nav-${item.id}`}
                  className={`nav-row ${active ? 'active' : ''}`}
                  onClick={() => switchView(item.id)}
                >
                  {active && (
                    <>
                      <motion.span layoutId="sidebar-bg" className="nav-row-bg" transition={{ type: 'spring', stiffness: 450, damping: 34 }} />
                      <motion.span layoutId="sidebar-bar" className="nav-row-bar" transition={{ type: 'spring', stiffness: 450, damping: 34 }} />
                    </>
                  )}
                  {item.icon}
                  <span className="label-text">{item.label}</span>
                  <span className="nav-badge">{item.badge}</span>
                </button>
              );
            })}
          </nav>

          <a className="sidebar-cta" href="/rules.html">
            <span>Compliance Rules &amp; AI Prompt</span>
            <span>→</span>
          </a>

          <div className="sidebar-stats">
            <div className="stat-row"><span>SOURCE</span><a href="https://github.com/jessekward-prog/hostess" target="_blank" rel="noopener">GitHub ↗</a></div>
            <div className="stat-row"><span>LOCAL PORT</span><span className="v">127.0.0.1:5300</span></div>
            <div className="stat-row"><span>REMOTE</span><span className="v">Tailscale / Tunnel</span></div>
          </div>
        </div>
      </aside>

      <main className="stage">
        <header className="stage-head">
          <div className="stage-top-row">
            <h1 className="hero-title">
              <span className="mark">
                <svg width="19" height="19" viewBox="0 0 100 100" fill="none"><circle cx="50" cy="50" r="42" stroke="#fff" strokeWidth="6"/><g stroke="#fff" strokeWidth="6" strokeLinecap="round"><path d="M50,41 C56,30 68,33 68,22 C68,13 59,9 51,13 C45,16 46,22 52,23"/><path d="M50,41 C56,30 68,33 68,22 C68,13 59,9 51,13 C45,16 46,22 52,23" transform="rotate(120,50,50)"/><path d="M50,41 C56,30 68,33 68,22 C68,13 59,9 51,13 C45,16 46,22 52,23" transform="rotate(240,50,50)"/></g><circle cx="50" cy="50" r="8" stroke="#fff" strokeWidth="4.4"/><g stroke="#fff" strokeWidth="4.4" strokeLinecap="round"><line x1="50" y1="44" x2="50" y2="56"/><line x1="50" y1="44" x2="50" y2="56" transform="rotate(60,50,50)"/><line x1="50" y1="44" x2="50" y2="56" transform="rotate(120,50,50)"/></g></svg>
              </span>
              <span>hostess<span className="caret-blink">_</span></span>
            </h1>
            <div className="meta-pills">
              <span className="meta-pill"><span className="dot" />Loopback · Tailscale · Quick Tunnel</span>
              <a className="meta-pill" href="https://github.com/jessekward-prog/hostess" target="_blank" rel="noopener">Source ↗</a>
            </div>
          </div>
          <p className="tagline">
            One command turns a clean machine into a self-hosted app platform. Point <strong>Hostess</strong> at any repo with an <code>app.yaml</code> + <code>Dockerfile</code> and it builds, wires Postgres/search/AI/push, and runs it in Docker.
          </p>
        </header>

        <AnimatePresence mode="wait">
          {view === 'install' && (
            <motion.section key="view-install" variants={VIEW_VARIANTS} initial="initial" animate="animate" exit="exit">
              <div className="seg-bar">
                <div className="seg-group" role="tablist" aria-label="Operating system">
                  {Object.entries(OS_DATA).map(([key, item]) => {
                    const active = os === key;
                    return (
                      <motion.button
                        key={key}
                        id={`os-tab-${key}`}
                        whileTap={{ scale: 0.96 }}
                        className={`seg-btn ${active ? 'active' : ''}`}
                        onClick={() => setOs(key)}
                        role="tab"
                        aria-selected={active}
                      >
                        {active && (
                          <motion.span
                            layoutId="os-seg-pill"
                            className="seg-pill-bg"
                            style={{ borderColor: item.tint }}
                            transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                          />
                        )}
                        <span className="os-dot" style={{ background: item.accent }} />
                        <span>{item.label}</span>
                      </motion.button>
                    );
                  })}
                </div>
                <span className="seg-meta">{currentOS.meta}</span>
              </div>

              <div className="terminal-card">
                <div className="terminal-bar">
                  <div className="terminal-title">
                    <span className="os-dot" style={{ background: currentOS.accent }} />
                    <span>{currentOS.barTitle}</span>
                    <span className="terminal-sub">{currentOS.barSub}</span>
                  </div>
                  <div className="terminal-actions">
                    <a className="link-out" href={currentOS.sourceUrl} target="_blank" rel="noopener">
                      {currentOS.sourceLabel}
                    </a>
                    <motion.button
                      whileTap={{ scale: 0.96 }}
                      className={`copy-primary-btn ${copied ? 'copied' : ''}`}
                      onClick={handleCopy}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                      <span>{copied ? 'Copied!' : 'Copy command'}</span>
                    </motion.button>
                  </div>
                </div>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={os}
                    initial={{ opacity: 0, y: 3 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -3 }}
                    transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
                    className="terminal-body"
                  >
                    <span className="terminal-prompt">{currentOS.prompt}</span>
                    <pre className="terminal-cmd">{currentOS.cmd}</pre>
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* Progressive Disclosure Bar: zero clutter until clicked */}
              <div className="disclosure-bar">
                {[
                  { id: 'expect', label: 'What to expect', count: '3 steps' },
                  { id: 'setup', label: 'What it sets up', count: 'architecture' },
                  { id: 'manual', label: 'Manual commands', count: `${currentOS.manual.length} blocks` },
                ].map((tab) => {
                  const isOpen = drawer === tab.id;
                  return (
                    <motion.button
                      key={tab.id}
                      id={`drawer-btn-${tab.id}`}
                      whileTap={{ scale: 0.97 }}
                      className={`disclosure-pill ${isOpen ? 'open' : ''}`}
                      onClick={() => setDrawer(isOpen ? null : tab.id)}
                    >
                      <span className="disclosure-chev">▸</span>
                      <span>{tab.label}</span>
                      <span className="disclosure-count">· {tab.count}</span>
                    </motion.button>
                  );
                })}
              </div>

              <AnimatePresence initial={false} mode="wait">
                {drawer === 'expect' && (
                  <motion.div
                    key={`expect-${os}`}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
                    className="drawer-wrap"
                  >
                    <div className="drawer-card">
                      <p className="drawer-desc" style={{ marginBottom: 12 }}>{currentOS.expectIntro}</p>
                      <ul className="expect-list">
                        {currentOS.expect.map((step) => (
                          <li key={step.tag}>
                            <span className="expect-tag">{step.tag}</span>
                            <span dangerouslySetInnerHTML={{ __html: step.html }} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  </motion.div>
                )}

                {drawer === 'setup' && (
                  <motion.div
                    key={`setup-${os}`}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
                    className="drawer-wrap"
                  >
                    <div className="drawer-card">
                      <p className="drawer-desc" dangerouslySetInnerHTML={{ __html: currentOS.setupHtml }} />
                    </div>
                  </motion.div>
                )}

                {drawer === 'manual' && (
                  <motion.div
                    key={`manual-${os}`}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
                    className="drawer-wrap"
                  >
                    <div className="drawer-card">
                      <div className="steps-grid">
                        {currentOS.manual.map((m) => (
                          <div key={m.title} className={`step-box ${m.wide ? 'wide' : ''}`}>
                            <p className="step-label">{m.title}</p>
                            <pre className="code-block">{m.code}</pre>
                          </div>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.section>
          )}

          {view === 'platform' && (
            <motion.section key="view-platform" variants={VIEW_VARIANTS} initial="initial" animate="animate" exit="exit">
              <div className="pillars-row">
                <div className="pillar-tile">
                  <div className="k">Bootstrap</div>
                  <div className="v">Docker + Node + service in 1 command</div>
                </div>
                <div className="pillar-tile">
                  <div className="k">Shared Backing</div>
                  <div className="v">Postgres, SearXNG, ntfy, LM Studio</div>
                </div>
                <div className="pillar-tile">
                  <div className="k">Phone Access</div>
                  <div className="v">Tailscale Private Link &amp; Quick Tunnel</div>
                </div>
                <div className="pillar-tile">
                  <div className="k">Built-In Tools</div>
                  <div className="v">Curated Marketplace + Forge builder</div>
                </div>
              </div>

              <div className="spec-list">
                {PLATFORM_SERVICES.map((svc) => {
                  const isOpen = openService === svc.id;
                  return (
                    <div key={svc.id} className={`spec-row ${isOpen ? 'open' : ''}`}>
                      <button
                        id={`svc-btn-${svc.id}`}
                        className="spec-row-btn"
                        onClick={() => setOpenService(isOpen ? null : svc.id)}
                      >
                        <div className="spec-row-left">
                          <span className="disclosure-chev" style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }}>▸</span>
                          <span className="spec-row-title">{svc.title}</span>
                          <span className="spec-row-summary">{svc.summary}</span>
                        </div>
                        <div className="spec-row-right">
                          <span className={`spec-badge ${svc.auto ? 'auto' : ''}`}>{svc.badge}</span>
                        </div>
                      </button>
                      <AnimatePresence initial={false}>
                        {isOpen && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
                            className="drawer-wrap"
                          >
                            <div className="spec-row-body" dangerouslySetInnerHTML={{ __html: svc.bodyHtml }} />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            </motion.section>
          )}

          {view === 'deploy' && (
            <motion.section key="view-deploy" variants={VIEW_VARIANTS} initial="initial" animate="animate" exit="exit">
              <div className="seg-bar">
                <div className="seg-group" role="tablist" aria-label="Deployment reference">
                  {[
                    { id: 'schema', label: 'app.yaml schema' },
                    { id: 'cli', label: 'Deploy (UI & CLI)' },
                    { id: 'lifecycle', label: 'Live AI (/api/lm)' },
                  ].map((tab) => {
                    const active = deployTab === tab.id;
                    return (
                      <motion.button
                        key={tab.id}
                        id={`deploy-tab-${tab.id}`}
                        whileTap={{ scale: 0.96 }}
                        className={`seg-btn ${active ? 'active' : ''}`}
                        onClick={() => setDeployTab(tab.id)}
                        role="tab"
                        aria-selected={active}
                      >
                        {active && (
                          <motion.span
                            layoutId="deploy-seg-pill"
                            className="seg-pill-bg"
                            transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                          />
                        )}
                        <span>{tab.label}</span>
                      </motion.button>
                    );
                  })}
                </div>
                <span className="seg-meta">Root requires Dockerfile + app.yaml</span>
              </div>

              <div className="deploy-workbench">
                <AnimatePresence mode="wait">
                  {deployTab === 'schema' && (
                    <motion.div
                      key="tab-schema"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.15 }}
                      className="yaml-split"
                    >
                      <pre className="yaml-code">
                        {MANIFEST_FIELDS.map((f) => (
                          <span
                            key={f.key}
                            className={`yaml-line ${activeField === f.key ? 'active' : ''}`}
                            onMouseEnter={() => setActiveField(f.key)}
                            onClick={() => setActiveField(f.key)}
                          >
                            <span className="k">{f.key}:</span> <span className="v">{f.val}</span>
                          </span>
                        ))}
                      </pre>
                      <ul className="manifest-list">
                        {MANIFEST_FIELDS.map((f) => (
                          <li
                            key={f.key}
                            className={activeField === f.key ? 'active' : ''}
                            onMouseEnter={() => setActiveField(f.key)}
                            onClick={() => setActiveField(f.key)}
                          >
                            <code className="k">{f.key}</code>
                            <span dangerouslySetInnerHTML={{ __html: f.desc }} />
                          </li>
                        ))}
                      </ul>
                    </motion.div>
                  )}

                  {deployTab === 'cli' && (
                    <motion.div
                      key="tab-cli"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.15 }}
                    >
                      <p className="drawer-desc" style={{ marginBottom: 12 }}>
                        Paste any GitHub repository URL or local directory path into the dashboard at <code>http://localhost:5300</code>, or deploy from a terminal:
                      </p>
                      <pre className="code-block" style={{ marginBottom: 12 }}>{`# Deploy from a GitHub repository
node deploy.js https://github.com/you/your-app

# Deploy from a local directory on disk
node deploy.js /path/to/local/repo`}</pre>
                      <p className="drawer-desc">
                        Redeploying the same app name reuses its assigned host port, container name, persistent <code>dataDir</code> volume, and Postgres role password.
                      </p>
                    </motion.div>
                  )}

                  {deployTab === 'lifecycle' && (
                    <motion.div
                      key="tab-lifecycle"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.15 }}
                    >
                      <p className="drawer-desc" style={{ marginBottom: 10 }}>
                        Every app that reads <code>LM_STUDIO_URL</code>, <code>LM_STUDIO_API_KEY</code>, and <code>LM_STUDIO_MODEL</code> receives your fleet AI settings automatically on deploy.
                      </p>
                      <p className="drawer-desc">
                        Apps that also implement the optional <code>GET/PUT /api/lm</code> contract (protected by <code>SYNC_SECRET</code>) get a live Local / Claude provider and model switcher right on their dashboard card without needing a container restart.
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        <footer className="stage-foot">
          <span>Zero telemetry · runs locally on Docker</span>
          <div className="foot-links">
            {view === 'install' && (
              <button className="foot-Jump" onClick={() => setView('platform')}>Platform services (6) →</button>
            )}
            {view === 'platform' && (
              <button className="foot-Jump" onClick={() => setView('deploy')}>app.yaml &amp; Deploy (8) →</button>
            )}
            {view === 'deploy' && (
              <a className="foot-Jump accent" href="/rules.html">Compliance Rules &amp; AI Prompt →</a>
            )}
          </div>
        </footer>
      </main>
    </div>
  );
}
