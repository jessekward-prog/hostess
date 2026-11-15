const { execFile, spawn } = require('child_process');
const os = require('os');
const fs = require('fs');

// `tailscale` is not always on PATH: the macOS app ships its CLI inside the app bundle, and on
// Windows a Hostess process started before Tailscale was installed still has the old PATH.
const FALLBACK_BIN = {
  darwin: '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  win32: 'C:\\Program Files\\Tailscale\\tailscale.exe',
}[process.platform];
let bin = 'tailscale';

function run(args, opts = {}) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: 10000, ...opts }, (err, stdout, stderr) => {
      if (err && err.code === 'ENOENT' && bin !== FALLBACK_BIN && FALLBACK_BIN && fs.existsSync(FALLBACK_BIN)) {
        bin = FALLBACK_BIN;
        return resolve(run(args, opts));
      }
      resolve({ ok: !err, code: err ? err.code : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

async function detect() {
  const version = await run(['version']);
  if (!version.ok) return { installed: false, loggedIn: false, platform: process.platform };

  const status = await run(['status', '--json']);
  if (!status.ok) return { installed: true, loggedIn: false, platform: process.platform };

  let parsed;
  try { parsed = JSON.parse(status.stdout); } catch { return { installed: true, loggedIn: false, platform: process.platform }; }

  const self = parsed.Self || {};
  const loggedIn = parsed.BackendState === 'Running';
  const hostname = (self.DNSName || '').replace(/\.$/, '');
  const peers = Object.values(parsed.Peer || {}).map((p) => ({
    name: p.HostName,
    hostname: (p.DNSName || '').replace(/\.$/, ''),
    os: p.OS,
    online: p.Online,
    joinedAt: p.Created,
  }));

  return { installed: true, loggedIn, hostname, peers, platform: process.platform };
}

function operatorCommand() {
  // No sudo on Windows: this one runs from an Administrator PowerShell.
  const cmd = `tailscale set --operator=${os.userInfo().username}`;
  return process.platform === 'win32' ? cmd : `sudo ${cmd}`;
}

function installCommand(platform) {
  if (platform === 'darwin') return null; // GUI app — direct to the download page instead
  if (platform === 'win32') return null;
  return 'curl -fsSL https://tailscale.com/install.sh | sh';
}

// `tailscale serve --bg` prints its error text immediately in the two known
// failure cases (tailnet Serve disabled / operator not granted), but the
// process itself doesn't reliably exit afterward — so this classifies from
// streamed output instead of waiting for exit, with a short grace window to
// call it a success once no error text has shown up.
function serve(port, https) {
  return new Promise((resolve) => {
    const proc = spawn(bin, ['serve', '--bg', `--https=${https}`, `http://127.0.0.1:${port}`]);
    let buf = '';
    let settled = false;
    const finish = (result) => { if (!settled) { settled = true; resolve(result); } };

    const onData = (chunk) => {
      buf += chunk.toString();
      const enableUrlMatch = buf.match(/https:\/\/login\.tailscale\.com\/f\/serve\?\S+/);
      if (enableUrlMatch) return finish({ ok: false, reason: 'tailnet-disabled', enableUrl: enableUrlMatch[0] });
      if (/operator|access denied/i.test(buf)) return finish({ ok: false, reason: 'operator', fixCommand: operatorCommand() });
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', (err) => {
      finish({ ok: false, reason: 'other', message: err.message });
    });
    proc.on('exit', (code) => {
      finish(code === 0 ? { ok: true } : { ok: false, reason: 'other', message: buf.trim() || `exit code ${code}` });
    });
    setTimeout(() => finish({ ok: true }), 3000);
  });
}

// `serve clear` takes a service name, not a port, and on 1.98 rejects --https outright, so the
// old form silently left every "turned off" link still published. This is the port-off form.
async function unserve(https) {
  await run(['serve', `--https=${https}`, 'off']);
}

async function servedPorts() {
  const result = await run(['serve', 'status', '--json']);
  if (!result.ok) return [];
  try {
    const parsed = JSON.parse(result.stdout || '{}');
    return Object.keys(parsed.TCP || {}).map(Number);
  } catch {
    return [];
  }
}

module.exports = { detect, serve, unserve, servedPorts, operatorCommand, installCommand };
