const { spawn } = require('child_process');

const URL_RE = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;
const HUB_KEY = '__hub__';
const AUTO_STOP_MS = 2 * 60 * 60 * 1000; // 2h — don't leave a public tunnel open indefinitely

const tunnels = new Map(); // key -> { url, port, proc, startedAt, timer }

function spawnQuickTunnel(port) {
  return new Promise((resolve, reject) => {
    // --config /dev/null is required: without it cloudflared falls back to
    // /etc/cloudflared/config.yml (the persistent named tunnel for
    // cmdward.xyz) and evaluates *that* file's ingress rules against this
    // random trycloudflare.com hostname, which matches nothing and falls
    // through to its http_status:404 catch-all instead of this app.
    const proc = spawn('cloudflared', ['tunnel', '--config', '/dev/null', '--url', `http://localhost:${port}`]);
    let settled = false;
    const onData = (buf) => {
      const match = buf.toString().match(URL_RE);
      if (match && !settled) {
        settled = true;
        proc.stderr.off('data', onData);
        resolve({ url: match[0], proc });
      }
    };
    proc.stderr.on('data', onData);
    proc.on('exit', () => {
      if (!settled) {
        settled = true;
        reject(new Error('cloudflared exited before a tunnel URL appeared'));
      }
    });
    setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill();
        reject(new Error('Timed out waiting for cloudflared to open a tunnel'));
      }
    }, 15000);
  });
}

async function start(key, port) {
  const existing = tunnels.get(key);
  if (existing) return { url: existing.url, startedAt: existing.startedAt };

  const { url, proc } = await spawnQuickTunnel(port);
  const timer = setTimeout(() => stop(key), AUTO_STOP_MS);
  const record = { url, port, proc, startedAt: new Date().toISOString(), timer };
  tunnels.set(key, record);
  proc.on('exit', () => {
    const current = tunnels.get(key);
    if (current && current.proc === proc) tunnels.delete(key);
  });
  return { url, startedAt: record.startedAt };
}

function stop(key) {
  const record = tunnels.get(key);
  if (!record) return;
  clearTimeout(record.timer);
  record.proc.kill();
  tunnels.delete(key);
}

function stopAll() {
  for (const key of [...tunnels.keys()]) stop(key);
}

function status() {
  const hub = tunnels.get(HUB_KEY) || null;
  const apps = [...tunnels.entries()]
    .filter(([key]) => key !== HUB_KEY)
    .map(([key, r]) => ({ name: key, url: r.url, startedAt: r.startedAt }));
  return {
    hub: hub ? { url: hub.url, startedAt: hub.startedAt } : null,
    apps,
  };
}

function hubActive() {
  return tunnels.has(HUB_KEY);
}

module.exports = { start, stop, stopAll, status, hubActive, HUB_KEY };
