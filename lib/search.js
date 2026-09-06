const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const docker = require('./docker');

// Deliberately NOT postgres.js's `selfhost-net`. SearXNG's whole job is fetching
// and parsing attacker-influenced content from the open internet, so it lives on
// a network the database is not on. Apps that ask for search are joined to both;
// SearXNG can then reach those apps and nothing else — verified: from this
// network, `selfhost-postgres` does not even resolve.
const NETWORK = 'hostess-search';
const CONTAINER = 'hostess-searxng';

// Pinned by digest, not `:latest` — an unattended `restart: unless-stopped`
// container on a home machine should not silently change what it is running.
// To update: docker pull searxng/searxng:latest, read the new digest, bump here.
const IMAGE = 'searxng/searxng@sha256:55e1fa15a63ff04e79e213e6aa2837549877b0c6d60757cdb633ae9111cb5fea';

const CONFIG_DIR = path.join(__dirname, '..', 'apps', '.searxng');
const SETTINGS_PATH = path.join(CONFIG_DIR, 'settings.yml');

// Internal DNS name; never published to the host, so nothing on the LAN can
// reach it and no port is exposed for an operator to accidentally forward.
const URL = `http://${CONTAINER}:8080`;

function secret() {
  const registry = require('./registry');
  let meta = registry.get('__searxng__');
  if (!meta || !meta.secretKey) {
    meta = registry.upsert('__searxng__', { secretKey: crypto.randomBytes(32).toString('hex') });
  }
  return meta.secretKey;
}

function writeSettings() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, `use_default_settings: true
server:
  secret_key: "${secret()}"
  limiter: false
  image_proxy: false
search:
  formats:
    - json
  safe_search: 0
  autocomplete: ""
general:
  instance_name: "hostess"
  donation_url: false
outgoing:
  request_timeout: 5.0
  max_request_timeout: 15.0
`);
}

async function ensure(log = () => {}) {
  await docker.ensureNetwork(NETWORK);
  writeSettings();

  if (await docker.containerExists(CONTAINER)) {
    if ((await docker.containerStatus(CONTAINER)) !== 'running') await docker.run(['start', CONTAINER]);
    return URL;
  }

  log('Starting the shared search backend (first time only) ...');
  await docker.run([
    'run', '-d',
    '--name', CONTAINER,
    '--network', NETWORK,
    '--restart', 'unless-stopped',
    // No -p: unreachable from the host and the LAN, only from apps that opted in.
    '--cap-drop', 'ALL',
    '--cap-add', 'CHOWN', '--cap-add', 'SETGID', '--cap-add', 'SETUID',
    '--security-opt', 'no-new-privileges',
    '-v', `${SETTINGS_PATH}:/etc/searxng/settings.yml:ro`,
    '--log-opt', 'max-size=10m', '--log-opt', 'max-file=3',
    IMAGE,
  ]);
  return URL;
}

// Called when an app stops declaring search, so a machine that no longer needs
// an internet-facing container isn't left running one.
async function removeIfUnused(log = () => {}) {
  const registry = require('./registry');
  const stillWanted = Object.entries(registry.readAll())
    .some(([name, r]) => !name.startsWith('__') && r.search);
  if (stillWanted) return false;
  if (await docker.containerExists(CONTAINER)) {
    log('No app declares search any more — stopping the search backend.');
    await docker.stopAndRemove(CONTAINER);
  }
  return true;
}

module.exports = { ensure, removeIfUnused, NETWORK, CONTAINER, URL };
