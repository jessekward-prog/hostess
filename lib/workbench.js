const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const docker = require('./docker');
const manifest = require('./manifest');
const registry = require('./registry');
const settings = require('./settings');

// Workbench: watch one folder on this machine and keep a live copy of the app in it running, so the
// dashboard can show it at phone and desktop size and reload both whenever a file changes.
// A folder with app.yaml + Dockerfile is built and run the way a deploy would (same image, its own
// data volume), so what you see is what Hostess will install. A plain folder with an index.html is
// served as static files. Nothing here touches the registry: it is not an installed app.
const CONTAINER = 'selfhost-workbench';
const IGNORE = /(^|[\\/])(\.git|node_modules|\.DS_Store)([\\/]|$)|~$|\.sw[px]$|\.tmp$/;

const state = { dir: null, mode: null, name: null, port: null, status: 'idle', error: null, version: 0, log: [] };
const listeners = new Set();
let watcher = null;
let staticServer = null;
let timer = null;
let building = null;
let again = false;

function emit(ev) { for (const fn of listeners) fn(ev); }
function snapshot() { const { log, ...s } = state; return s; }
function setStatus(status, error = null) { Object.assign(state, { status, error }); emit({ type: 'state', state: snapshot() }); }
function log(line) {
  state.log.push(line);
  if (state.log.length > 400) state.log.splice(0, state.log.length - 400);
  emit({ type: 'log', line });
}

function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// The container has answered once something is listening; any HTTP status counts.
async function waitForPort(port, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const up = await new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1000 }, (res) => { res.resume(); resolve(true); });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
    if (up) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// App crashes print to stderr, which docker.logs() (stdout only) would drop.
function containerLogs() {
  return new Promise((resolve) => require('child_process').execFile('docker', ['logs', '--tail', '40', CONTAINER], (_e, out, err) => resolve(`${out}${err}`.trim())));
}

async function rebuild() {
  if (building) { again = true; return building; }
  building = (async () => {
    do {
      again = false;
      const dir = state.dir;
      try {
        if (state.mode === 'static') {
          state.version++;
          setStatus('running');
          emit({ type: 'reload', version: state.version });
          continue;
        }
        setStatus('building');
        state.log = [];
        const app = manifest.load(dir);
        state.name = app.name;
        log(`Building ${app.name} from ${dir} ...`);
        await docker.buildImage(`${CONTAINER}:latest`, dir, log);
        if (dir !== state.dir) continue; // switched folders mid-build
        await docker.stopAndRemove(CONTAINER);
        await docker.runContainer({
          name: CONTAINER,
          image: `${CONTAINER}:latest`,
          hostPort: state.port,
          containerPort: app.port,
          dataDir: app.dataDir,
          dataVolume: `${CONTAINER}-${app.name}-data`,
        });
        log(`Started on http://127.0.0.1:${state.port}, waiting for it to answer ...`);
        if (!(await waitForPort(state.port))) {
          const out = await containerLogs();
          throw new Error(`The app didn't answer on port ${app.port} inside the container.${out ? `\n${out}` : ''}`);
        }
        state.version++;
        log('Ready.');
        setStatus('running');
        emit({ type: 'reload', version: state.version });
      } catch (err) {
        if (dir !== state.dir) continue;
        log(err.message);
        setStatus('error', err.message.split('\n')[0]);
      }
    } while (again);
  })().finally(() => { building = null; }); // a microtask, so it runs after this assignment even when nothing above awaited
  return building;
}

function onChange(_event, file) {
  if (file && IGNORE.test(String(file))) return;
  clearTimeout(timer);
  timer = setTimeout(rebuild, 400);
}

async function stop() {
  clearTimeout(timer);
  if (watcher) watcher.close();
  if (staticServer) staticServer.close();
  watcher = staticServer = null;
  await docker.stopAndRemove(CONTAINER).catch(() => {});
  Object.assign(state, { dir: null, mode: null, name: null, port: null, status: 'idle', error: null, log: [] });
  emit({ type: 'state', state: snapshot() });
}

async function start(rawDir) {
  const dir = path.resolve(String(rawDir || '').trim().replace(/^~(?=$|[\\/])/, require('os').homedir()));
  if (!rawDir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`No folder at ${dir}`);
  const hasApp = fs.existsSync(path.join(dir, 'app.yaml')) && fs.existsSync(path.join(dir, 'Dockerfile'));
  const staticRoot = ['', 'public'].map((d) => path.join(dir, d)).find((d) => fs.existsSync(path.join(d, 'index.html')));
  if (!hasApp && !staticRoot) throw new Error('That folder has no app.yaml + Dockerfile and no index.html to show.');

  await stop();
  const taken = new Set(Object.values(registry.readAll()).map((r) => r.port).filter(Boolean));
  Object.assign(state, { dir, mode: hasApp ? 'docker' : 'static', port: await docker.findFreePort(taken, 5400, 5499) });
  settings.set('workbenchDir', dir);

  if (!hasApp) {
    const srv = express();
    srv.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    srv.use(express.static(staticRoot));
    staticServer = srv.listen(state.port, '127.0.0.1');
    state.name = path.basename(dir);
  }
  // ponytail: recursive fs.watch needs Node 20+ on Linux; Hostess already requires Node 22 in practice.
  watcher = fs.watch(dir, { recursive: true }, onChange);
  watcher.on('error', (err) => setStatus('error', `Stopped watching: ${err.message}`));
  rebuild();
  return snapshot();
}

// Subfolders of a path, for the folder picker. Hidden folders and node_modules are left out.
function listDirs(raw) {
  const dir = path.resolve(String(raw || '').trim().replace(/^~(?=$|[\\/])/, require('os').homedir()) || require('os').homedir());
  const dirs = fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
    .map((d) => d.name).sort((a, b) => a.localeCompare(b));
  const isApp = fs.existsSync(path.join(dir, 'app.yaml')) || fs.existsSync(path.join(dir, 'index.html')) || fs.existsSync(path.join(dir, 'public', 'index.html'));
  return { dir, parent: path.dirname(dir), dirs, isApp };
}

module.exports = {
  start, stop, rebuild, subscribe, listDirs,
  status: () => ({ ...snapshot(), log: state.log, remembered: settings.get('workbenchDir') || '' }),
  // A container left over from before a restart has nothing watching it.
  cleanup: () => docker.stopAndRemove(CONTAINER).catch(() => {}),
};
