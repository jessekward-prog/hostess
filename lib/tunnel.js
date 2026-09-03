const { spawn } = require('child_process');

const URL_RE = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;
const HUB_KEY = '__hub__';
const SAFETY_STOP_MS = 12 * 60 * 60 * 1000; // 12h forgot-to-turn-it-off net, not a routine cutoff
const MAX_CONSECUTIVE_FAILS = 6;

const tunnels = new Map(); // key -> { url, port, proc, startedAt, timer, stopped, failCount }

function spawnQuickTunnel(port) {
  return new Promise((resolve, reject) => {
    // --config /dev/null is required: without it cloudflared falls back to
    // /etc/cloudflared/config.yml (a persistent named tunnel, if this box has
    // one) and evaluates *that* file's ingress rules against this random
    // trycloudflare.com hostname, which matches nothing and 404s everything
    // via its catch-all instead of reaching this app.
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

// Free Quick Tunnels have no uptime guarantee and do occasionally drop. Rather
// than surface that as "the link died," reopen automatically — the caller
// (dashboard) just polls status() and picks up the new URL if it changed.
function scheduleRespawn(key, port, delayMs) {
  setTimeout(async () => {
    const record = tunnels.get(key);
    if (!record || record.stopped) return; // stopped intentionally in the meantime
    try {
      const { url, proc } = await spawnQuickTunnel(port);
      record.url = url;
      record.proc = proc;
      record.startedAt = new Date().toISOString();
      record.failCount = 0;
      attachExitHandler(key, proc, port);
    } catch (err) {
      record.failCount = (record.failCount || 0) + 1;
      if (record.failCount >= MAX_CONSECUTIVE_FAILS) {
        console.error(`[tunnel] giving up on "${key}" after ${record.failCount} failed reconnects: ${err.message}`);
        tunnels.delete(key);
        return;
      }
      scheduleRespawn(key, port, Math.min(2000 * record.failCount, 30000));
    }
  }, delayMs);
}

function attachExitHandler(key, proc, port) {
  proc.on('exit', () => {
    const record = tunnels.get(key);
    if (!record || record.proc !== proc || record.stopped) return;
    scheduleRespawn(key, port, 1000);
  });
}

async function start(key, port) {
  const existing = tunnels.get(key);
  if (existing) return { url: existing.url, startedAt: existing.startedAt };

  const { url, proc } = await spawnQuickTunnel(port);
  const timer = setTimeout(() => stop(key), SAFETY_STOP_MS);
  const record = { url, port, proc, startedAt: new Date().toISOString(), timer, stopped: false, failCount: 0 };
  tunnels.set(key, record);
  attachExitHandler(key, proc, port);
  return { url, startedAt: record.startedAt };
}

function stop(key) {
  const record = tunnels.get(key);
  if (!record) return;
  record.stopped = true;
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
