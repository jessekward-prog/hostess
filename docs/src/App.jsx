import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const OS_DATA = {
  linux: {
    label: 'Linux',
    prompt: '$',
    meta: 'Debian / Ubuntu family · apt + user systemd service',
    sourceLabel: 'install.sh',
    sourceUrl: 'https://github.com/jessekward-prog/hostess/blob/main/install.sh',
    cmd: '(command -v git >/dev/null 2>&1 || (sudo apt-get update -y && sudo apt-get install -y git)) && (git clone --depth 1 https://github.com/jessekward-prog/hostess.git ~/hostess || git -C ~/hostess pull --ff-only) && ~/hostess/install.sh',
    expectIntro: 'Mostly unattended. Every prompt on a clean Debian or Ubuntu box:',
    expect: [
      { html: 'Terminal asks for your <b>sudo password</b> once to install missing packages via <code>apt</code> and Docker\'s official repository.' },
      { html: 'If Docker was just installed, log out and back in so your new <code>docker</code> group membership applies, then run <code>systemctl --user start hostess</code>.' },
      { html: 'Otherwise it prints <code>http://localhost:5300</code> and opens the dashboard in your browser.' },
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
        code: `systemctl --user status  hostess
systemctl --user restart hostess
systemctl --user stop    hostess`,
      },
    ],
  },
  macos: {
    label: 'macOS',
    prompt: '%',
    meta: 'Apple Silicon or Intel · Homebrew + launchd agent',
    sourceLabel: 'install-macos.sh',
    sourceUrl: 'https://github.com/jessekward-prog/hostess/blob/main/install-macos.sh',
    cmd: 'if ! xcode-select -p >/dev/null 2>&1; then xcode-select --install; echo "Approve the Command Line Tools dialog, then re-run this command."; else (git clone --depth 1 https://github.com/jessekward-prog/hostess.git ~/hostess || git -C ~/hostess pull --ff-only) && ~/hostess/install-macos.sh; fi',
    expectIntro: 'Prompts you will see:',
    expect: [
      { html: 'If macOS Command Line Tools aren\'t installed yet, macOS pops up an install dialog. Approve it, then re-run the command.' },
      { html: 'Terminal asks for your <b>Mac login password</b> once for Homebrew and Docker Desktop installation.' },
      { html: 'Docker Desktop\'s first launch shows a <b>permissions dialog</b>. Approve it (no Docker Hub account required), and your browser opens to <code>http://localhost:5300</code>.' },
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
        code: `launchctl unload ~/Library/LaunchAgents/xyz.cmdward.hostess.plist
launchctl load -w ~/Library/LaunchAgents/xyz.cmdward.hostess.plist`,
      },
    ],
  },
  windows: {
    label: 'Windows',
    prompt: 'PS>',
    meta: 'Windows 10/11 PowerShell · winget + Scheduled Task (UAC)',
    sourceLabel: 'install.ps1',
    sourceUrl: 'https://github.com/jessekward-prog/hostess/blob/main/install.ps1',
    cmd: 'iwr -useb https://raw.githubusercontent.com/jessekward-prog/hostess/main/install.ps1 | iex',
    expectIntro: 'Paste into PowerShell (Start menu, then PowerShell):',
    expect: [
      { html: 'A <b>UAC prompt</b> appears. Click Yes; a new elevated PowerShell window opens and runs the installation.' },
      { html: 'If WSL2 was never enabled on this PC, it enables WSL2 and asks you to reboot once, then paste the same command again.' },
      { html: 'Accept Docker Desktop\'s first-run license dialog (skip Docker Hub sign-in). Your browser opens to <code>http://localhost:5300</code> once Docker is ready.' },
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
        code: `$action = New-ScheduledTaskAction -Execute "powershell.exe" \`
  -Argument '-NoProfile -WindowStyle Hidden -Command "while ($true) { Set-Location $HOME\\hostess; node server.js; Start-Sleep -Seconds 2 }"'
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
Register-ScheduledTask -TaskName hostess -Action $action -Trigger $trigger -Force
Start-ScheduledTask -TaskName hostess`,
      },
      {
        title: '5. Service control',
        code: `Start-ScheduledTask -TaskName hostess
Stop-ScheduledTask  -TaskName hostess`,
      },
    ],
  },
};

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

const MANIFEST_FIELDS = [
  { key: 'name', val: 'my-app', req: true, desc: 'Lowercase letters, numbers and hyphens, 2 to 50 characters. Names the container, the database and the card.' },
  { key: 'port', val: '3000', req: true, desc: 'Port the app listens on inside the container. Bind <code>0.0.0.0</code>, not localhost. Hostess does not inject <code>PORT</code>; it maps a host port from 4000 to 4999 and keeps it across redeploys.' },
  { key: 'postgres', val: 'true', desc: 'Creates a role and database for the app in one shared Postgres 16 container and injects <code>DATABASE_URL</code> plus <code>DB_HOST</code>, <code>DB_PORT</code>, <code>DB_NAME</code>, <code>DB_USER</code> and <code>DB_PASSWORD</code>.' },
  { key: 'search', val: 'true', desc: 'Starts a shared SearXNG on its own Docker network, one Postgres is not on, and injects <code>SEARXNG_URL</code>.' },
  { key: 'dataDir', val: '/app/data', desc: 'Absolute container path kept in a named Docker volume, so local files survive redeploys.' },
  { key: 'autoUpdate', val: 'true', desc: 'Checks the source repo about every 10 minutes and redeploys when its default branch moves. Local-path sources are skipped.' },
  { key: 'publicGateway', val: '{ port: 3001 }', desc: 'A second, narrow port that Hostess can tunnel publicly when you tick "Allow sharing features" on the card. The app reads its public address from <code>/run/hostess-gateway/url</code>.' },
  { key: 'env', val: '[SOME_KEY]', desc: 'Names to fill in on the app card. Values are passed at <code>docker run</code>, so saving one redeploys the app.' },
  { key: 'description', val: 'One line', desc: 'Shown on the card, up to 200 characters.' },
  { key: 'icon', val: 'public/icon.svg', desc: 'Path in the repo to an <code>.svg</code>, <code>.png</code> or <code>.ico</code> used as the card logo.' },
];

const PLATFORM = [
  {
    title: 'Local AI',
    desc: 'Point the dashboard\'s MY AI panel at LM Studio, Ollama or any OpenAI-compatible server. Apps whose JS or TS source reads <code>LM_STUDIO_URL</code>, <code>LM_STUDIO_API_KEY</code> or <code>LM_STUDIO_MODEL</code> get those values at deploy with no <code>app.yaml</code> entry. Apps in other languages list the names under <code>env</code>.',
  },
  {
    title: 'Security guard',
    desc: 'With a model connected, the <code>Dockerfile</code>, <code>app.yaml</code> and entrypoint are reviewed before each build. A high-risk result blocks the deploy; low and medium show as a chip on the card. With no model connected the scan is skipped.',
  },
  {
    title: 'Push',
    desc: 'One built-in ntfy server for every app, published to your own devices over Tailscale and never to the LAN or internet. Apps that read <code>NTFY_URL</code>, <code>NTFY_TOKEN</code> and <code>NTFY_TOPIC</code> are joined to it on their next deploy.',
  },
  {
    title: 'Phone access',
    desc: '<b>Go Online</b> opens a free Cloudflare Quick Tunnel to the dashboard and shows a QR code; the address changes each time. <b>Private Link</b> walks you through Tailscale for a permanent address only your devices can reach. Every path sits behind the same account login.',
  },
  {
    title: 'Marketplace',
    desc: 'A short hand-picked list of apps that install in one click.',
  },
  {
    title: 'Forge',
    desc: 'Describe an app, watch your local model write it, try it in a sandboxed preview, then install it as a normal Hostess app.',
  },
];

const Mark = () => (
  <svg width="30" height="30" viewBox="0 0 100 100" fill="none" aria-hidden="true">
    <circle cx="50" cy="50" r="42" stroke="#fff" strokeWidth="6" />
    <g stroke="#fff" strokeWidth="6" strokeLinecap="round">
      {[0, 120, 240].map((r) => (
        <path key={r} d="M50,41 C56,30 68,33 68,22 C68,13 59,9 51,13 C45,16 46,22 52,23" transform={`rotate(${r},50,50)`} />
      ))}
    </g>
    <circle cx="50" cy="50" r="8" stroke="#fff" strokeWidth="4.4" />
    <g stroke="#fff" strokeWidth="4.4" strokeLinecap="round">
      {[0, 60, 120].map((r) => (
        <line key={r} x1="50" y1="44" x2="50" y2="56" transform={`rotate(${r},50,50)`} />
      ))}
    </g>
  </svg>
);

const HecateMascot = () => {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
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

  return (
    <div className="mascot" title="Hecate: three faces, one doorway">
      <div className="mascot-canvas">
        <canvas ref={canvasRef} width={340} height={250} />
        <div className="mascot-scanlines" />
      </div>
      <div className="mascot-plaque">
        <span className="dot" />
        <span>Hecate</span>
        <span className="slash">/</span>
        <span>watching <span className="inf">∞</span></span>
      </div>
    </div>
  );
};

const Html = ({ as: Tag = 'span', html, ...rest }) => <Tag {...rest} dangerouslySetInnerHTML={{ __html: html }} />;

export default function App() {
  const [os, setOs] = useState('linux');
  const [manualOpen, setManualOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState(null);

  useEffect(() => {
    const ua = navigator.userAgent;
    if (/Windows/.test(ua)) setOs('windows');
    else if (/Mac OS X|Macintosh/.test(ua)) setOs('macos');
  }, []);

  const cur = OS_DATA[os];

  const copy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      setCopiedKey(null);
    }
  };

  return (
    <main>
      <header className="top">
        <div className="top-left">
          <h1><span className="mark"><Mark /></span>Hostess<span className="caret">_</span></h1>
          <p className="tagline">
            A self-hosted app platform. One command sets it up on Debian or Ubuntu, macOS, or Windows. Give it a repo with an <code>app.yaml</code> and a <code>Dockerfile</code> and it builds, runs and manages the app in Docker.
          </p>
        </div>
        <HecateMascot />
        <div className="top-right">
          <div className="pills">
            <a className="pill" href="/rules.html">Compliance Rules</a>
            <a className="pill" href="https://github.com/jessekward-prog/hostess" target="_blank" rel="noopener">GitHub ↗</a>
          </div>
          <span className="status"><span className="dot" />Dashboard binds to 127.0.0.1:5300 only</span>
        </div>
      </header>

      <section id="install">
        <h2>Install</h2>
        <div className="os-row">
          <div className="os-tabs" role="tablist" aria-label="Operating system">
            {Object.entries(OS_DATA).map(([key, item]) => (
              <button key={key} role="tab" aria-selected={os === key} className={`os-tab ${os === key ? 'active' : ''}`} onClick={() => setOs(key)}>
                <span>{item.label}</span><span className="tab-caret" aria-hidden="true">_</span>
              </button>
            ))}
          </div>
          <span className="os-meta">{cur.meta}</span>
        </div>

        <div className="card">
          <div className="cmd">
            <span className="prompt">{cur.prompt}</span>
            <pre>{cur.cmd}</pre>
          </div>
          <div className="cmd-actions">
            <button className="btn" onClick={() => copy(cur.cmd, 'install')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="miter" shapeRendering="crispEdges" aria-hidden="true">
                {copiedKey === 'install'
                  ? <path d="M4 12l6 6L20 6" />
                  : <><rect x="9" y="9" width="12" height="12" /><path d="M5 15H3V3h12v2" /></>}
              </svg>
              <span>{copiedKey === 'install' ? 'Copied' : 'Copy command'}</span>
            </button>
            <span className="note">Safe to re-run. Read it first: <a href={cur.sourceUrl} target="_blank" rel="noopener">{cur.sourceLabel} ↗</a></span>
          </div>

          <div className="split">
            <div>
              <h3>What to expect</h3>
              <p className="muted">{cur.expectIntro}</p>
              <ol className="steps">
                {cur.expect.map((step, i) => <li key={i}><Html html={step.html} /></li>)}
              </ol>
            </div>
            <div>
              <h3>What it sets up</h3>
              <Html as="p" className="muted" html={cur.setupHtml} />
            </div>
          </div>

          <button className={`reveal-toggle ${manualOpen ? 'open' : ''}`} aria-expanded={manualOpen} onClick={() => setManualOpen((v) => !v)}>
            <span className="chev">▸</span><span>do it by hand instead</span>
          </button>
          <AnimatePresence initial={false}>
            {manualOpen && (
              <motion.div
                className="reveal"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
              >
                <div className="manual">
                  {cur.manual.map((block, idx) => {
                    const key = `${os}-${idx}`;
                    return (
                      <div key={key} className="manual-block">
                        <div className="manual-head">
                          <span>{block.title}</span>
                          <button className="link-btn" onClick={() => copy(block.code, key)}>{copiedKey === key ? 'copied' : 'copy'}</button>
                        </div>
                        <pre className="code">{block.code}</pre>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      <section id="deploy">
        <h2>Deploy an app</h2>
        <p className="lead">
          A repo needs two files at its root: an <code>app.yaml</code> and a <code>Dockerfile</code> that builds something listening on <code>port</code>. Only <code>name</code> and <code>port</code> are required.
        </p>
        <div className="card rows">
          {MANIFEST_FIELDS.map((f) => (
            <div className="row" key={f.key}>
              <div className="row-key">
                <span className="k">{f.key}:</span> <span className="v">{f.val}</span>
                {f.req && <span className="req">required</span>}
              </div>
              <Html as="p" html={f.desc} />
            </div>
          ))}
        </div>
        <p className="lead">Paste the repo URL or a local path into the dashboard, or use the CLI from the Hostess folder:</p>
        <pre className="code">{`node deploy.js https://github.com/you/your-app
node deploy.js /path/to/local/repo`}</pre>
        <p className="lead">
          Redeploying keeps the app's host port, container name, data volume and database password. Compliance Rules, linked at the top, lists everything a repo needs and includes a prompt you can hand an AI agent to bring one into line.
        </p>
      </section>

      <section id="platform">
        <h2>Built in</h2>
        <p className="lead">Nothing here needs a line in <code>app.yaml</code>.</p>
        <div className="card rows">
          {PLATFORM.map((p) => (
            <div className="row" key={p.title}>
              <div className="row-key"><span className="k">{p.title}</span></div>
              <Html as="p" html={p.desc} />
            </div>
          ))}
        </div>
      </section>

      <footer>jessekward-prog/hostess. Personal project, no telemetry, nothing leaves your machine.</footer>
    </main>
  );
}
