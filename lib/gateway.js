const fs = require('fs');
const path = require('path');
const tunnel = require('./tunnel');
const registry = require('./registry');

const APPS_DIR = path.join(__dirname, '..', 'apps');
const SYNC_INTERVAL_MS = 5000;

// The "operator decides exposure, not the app" boundary (RULES.html §3) means
// an app never gets to spawn its own tunnel — it only reads a URL Hostess
// hands it here. A file, not a live API call: no new host-listening surface,
// no docker-bridge reachability question, and it still works if the app's
// own process restarts mid-tunnel.
function keyFor(name) { return `${name}:gateway`; }
function dirFor(name) { return path.join(APPS_DIR, name, '.gateway'); }
function urlFileFor(name) { return path.join(dirFor(name), 'url'); }

function writeUrlFile(name, url) {
  fs.mkdirSync(dirFor(name), { recursive: true });
  fs.writeFileSync(urlFileFor(name), url || '');
}

async function enable(name) {
  const record = registry.get(name);
  if (!record) throw new Error('No such app');
  if (!record.gatewayPort) throw new Error('This app does not declare a publicGateway port in app.yaml');
  const { url } = await tunnel.start(keyFor(name), record.gatewayPort);
  writeUrlFile(name, url);
  return { url };
}

function disable(name) {
  tunnel.stop(keyFor(name));
  writeUrlFile(name, null);
}

function currentUrl(name) {
  return tunnel.getUrl(keyFor(name));
}

// Free Quick Tunnels can drop and get auto-reopened in the background
// (lib/tunnel.js's own respawn logic) with a new URL and no notification —
// keep every enabled gateway's handoff file in sync so an app reading it at
// share-time is never more than a few seconds stale.
setInterval(() => {
  const all = registry.readAll();
  for (const name of Object.keys(all)) {
    if (name === '__postgres__' || !all[name].gatewayPort) continue;
    const url = tunnel.getUrl(keyFor(name));
    if (url) writeUrlFile(name, url);
  }
}, SYNC_INTERVAL_MS);

module.exports = { enable, disable, currentUrl, keyFor };
