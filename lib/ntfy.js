const crypto = require('crypto');
const docker = require('./docker');
const settings = require('./settings');
const tailscale = require('./tailscale');

// Push notifications for every app, set in the dashboard's PUSH panel. Three modes:
//   builtin  Hostess runs its own ntfy. Same shape as the search backend (lib/search.js): its
//            own network that only apps reading NTFY_* join, a digest-pinned image, dropped
//            capabilities. Unlike search it needs a way in, because the phone has to reach it:
//            a loopback port that `tailscale serve` publishes to the operator's own tailnet.
//            Never the LAN, never the internet.
//   ntfysh   ntfy's free public server with a long random topic. Nothing to run, but the topic
//            is the only secret.
//   custom   the operator's own ntfy server (address, optional token, topic).
const NETWORK = 'hostess-push';
const CONTAINER = 'hostess-ntfy';
const VOLUME = 'hostess-ntfy-data';
// To update: docker pull binwiederhier/ntfy:latest, read the new digest, bump here.
const IMAGE = 'binwiederhier/ntfy@sha256:6ef4b819f722fccdc036af611c4774cfdc2de821ab74fdd48bbf4c9d6f8973da';
const PORT = 5301; // loopback on this machine, and the same port on the tailnet
const INTERNAL_URL = `http://${CONTAINER}`; // what apps get as NTFY_URL in builtin mode
const BUILTIN_TOPIC = 'hostess';

const registry = () => require('./registry');

function mode() {
  return settings.get('ntfyMode') || (settings.get('ntfyUrl') ? 'custom' : '');
}

// What apps get injected (and what "send test" publishes to), for the current mode.
// hostUrl is how this machine itself reaches the server; phoneUrl is how a phone does.
function config() {
  const m = mode();
  if (m === 'builtin') {
    const meta = registry().get('__ntfy__');
    if (!meta || !meta.appToken) return { mode: m };
    return { mode: m, url: INTERNAL_URL, hostUrl: `http://127.0.0.1:${PORT}`, phoneUrl: meta.phoneUrl, token: meta.appToken, topic: BUILTIN_TOPIC, network: NETWORK };
  }
  if (m === 'ntfysh') {
    const topic = settings.get('ntfyShTopic');
    return topic ? { mode: m, url: 'https://ntfy.sh', hostUrl: 'https://ntfy.sh', phoneUrl: 'https://ntfy.sh', token: '', topic } : { mode: m };
  }
  if (m === 'custom') {
    const url = settings.get('ntfyUrl');
    return url ? { mode: m, url, hostUrl: url, phoneUrl: url, token: settings.get('ntfyToken') || '', topic: settings.get('ntfyTopic') || '' } : { mode: m };
  }
  return { mode: '' };
}

// ntfy's app link: ntfy://<host[:port]>/<topic>, opened on a phone it subscribes in one tap.
// Plain-http servers need secure=false.
function phoneLink(c) {
  if (!c.phoneUrl || !c.topic) return null;
  const u = new URL(c.phoneUrl);
  return `ntfy://${u.host}/${c.topic}${u.protocol === 'http:' ? '?secure=false' : ''}`;
}

const exec = (args, env = []) => docker.run(['exec', ...env.flatMap((e) => ['-e', e]), CONTAINER, 'ntfy', ...args]);

async function waitReady() {
  for (let i = 0; i < 20; i++) {
    try { await exec(['user', 'list']); return; } catch { await new Promise((r) => setTimeout(r, 500)); }
  }
  throw new Error('The push server did not start.');
}

// Idempotent: safe to run on every deploy and every "turn on".
async function ensureBuiltin(log = () => {}) {
  const ts = await tailscale.detect();
  if (!ts.installed || !ts.loggedIn || !ts.hostname) {
    throw Object.assign(new Error('Tailscale is not set up on this machine yet. Turn on Private Link first; your phone reaches the built-in server through it.'), { reason: 'tailscale' });
  }
  const phoneUrl = `https://${ts.hostname}:${PORT}`;

  await docker.ensureNetwork(NETWORK);
  if (!(await docker.containerExists(CONTAINER))) {
    log('Starting the built-in push server (first time only) ...');
    await docker.run([
      'run', '-d', '--name', CONTAINER, '--network', NETWORK, '--restart', 'unless-stopped',
      '-p', `127.0.0.1:${PORT}:80`, // loopback only; tailscale serve below is the only way in from outside
      '-v', `${VOLUME}:/var/lib/ntfy`,
      '-e', `NTFY_BASE_URL=${phoneUrl}`,
      '-e', 'NTFY_AUTH_FILE=/var/lib/ntfy/user.db',
      '-e', 'NTFY_AUTH_DEFAULT_ACCESS=deny-all',
      '-e', 'NTFY_CACHE_FILE=/var/lib/ntfy/cache.db',
      '-e', 'NTFY_BEHIND_PROXY=true',
      // Lets the iPhone app wake instantly. ntfy.sh only ever receives a poll request for a hashed
      // topic, never the message itself.
      '-e', 'NTFY_UPSTREAM_BASE_URL=https://ntfy.sh',
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--log-opt', 'max-size=10m', '--log-opt', 'max-file=3',
      IMAGE, 'serve',
    ]);
  } else if ((await docker.containerStatus(CONTAINER)) !== 'running') {
    await docker.run(['start', CONTAINER]);
  }
  await waitReady();

  // Apps publish with a write-only token. Reading the topic needs no login: the only devices that
  // can reach this server at all are the operator's own, on their tailnet.
  let meta = registry().get('__ntfy__') || {};
  if (!meta.appToken) {
    try { await exec(['user', 'add', 'apps'], [`NTFY_PASSWORD=${crypto.randomBytes(24).toString('hex')}`]); }
    catch (err) { if (!/already exists/i.test(err.message)) throw err; }
    await exec(['access', 'apps', '*', 'write-only']);
    // the CLI may print the new token on stderr, which docker.run drops, so merge the two
    const out = await docker.run(['exec', CONTAINER, 'sh', '-c', 'ntfy token add --label=hostess-apps apps 2>&1']);
    const token = out.match(/tk_[A-Za-z0-9]+/);
    if (!token) throw new Error('Could not create the apps token on the push server.');
    meta = registry().upsert('__ntfy__', { appToken: token[0] });
  }
  await exec(['access', 'everyone', BUILTIN_TOPIC, 'read-only']);

  if (!(await tailscale.servedPorts()).includes(PORT)) {
    const served = await tailscale.serve(PORT, PORT);
    if (!served.ok) throw Object.assign(new Error(served.message || 'Tailscale would not publish the push server.'), served);
  }
  registry().upsert('__ntfy__', { phoneUrl });
  return config();
}

// Switching away from builtin removes the server, so nothing is left running that no app uses.
async function removeBuiltin() {
  await tailscale.unserve(PORT).catch(() => {});
  if (await docker.containerExists(CONTAINER)) await docker.stopAndRemove(CONTAINER);
  await docker.run(['volume', 'rm', VOLUME]).catch(() => {});
  registry().remove('__ntfy__');
}

async function setMode(next, log = () => {}) {
  const prev = mode();
  if (next === 'builtin') await ensureBuiltin(log);
  if (next === 'ntfysh' && !settings.get('ntfyShTopic')) {
    // Long and random: on a public server the topic name is the only thing keeping messages private.
    settings.set('ntfyShTopic', `hostess-${crypto.randomBytes(12).toString('hex')}`);
  }
  if (prev === 'builtin' && next !== 'builtin') await removeBuiltin();
  settings.set('ntfyMode', next);
  return config();
}

module.exports = { mode, config, phoneLink, ensureBuiltin, removeBuiltin, setMode, NETWORK, CONTAINER, PORT };
