const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const docker = require('./docker');
const manifest = require('./manifest');
const registry = require('./registry');
const settings = require('./settings');
const postgres = require('./postgres');

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
const dbPasswords = new Map(); // app name -> workbench role password, so rebuilds don't rotate it

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
async function waitForPort(port, ms = 60000) {
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
        // Its own database (wb-<name>), never the installed app's: provisioning reuses a role's
        // password only if we pass it, and a real install's would otherwise be rotated.
        let env = {};
        if (app.postgres) {
          const db = await postgres.provisionDatabase(`wb-${app.name}`, dbPasswords.get(app.name));
          dbPasswords.set(app.name, db.rolePassword);
          env = { DATABASE_URL: db.databaseUrl, DB_HOST: db.dbHost, DB_PORT: String(db.dbPort), DB_NAME: db.dbName, DB_USER: db.dbUser, DB_PASSWORD: db.rolePassword };
          log(`Database ready (${db.dbName}).`);
        }
        await docker.stopAndRemove(CONTAINER);
        await docker.runContainer({
          name: CONTAINER,
          image: `${CONTAINER}:latest`,
          network: app.postgres ? postgres.NETWORK : undefined,
          env,
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

// Polls instead of fs.watch: recursive fs.watch needs Node 20+ on Linux and Hostess supports 18+.
// ponytail: a full stat walk every 800ms; fine for a source tree (node_modules and .git are skipped),
// it stops at 20k files. Upgrade path is fs.watch once the floor is Node 20.
function signature(dir) {
  let sig = '';
  let count = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (IGNORE.test(full) || ++count > 20000) continue;
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) { const st = fs.statSync(full); sig += `${full}:${st.mtimeMs}:${st.size}\n`; }
    }
  };
  try { walk(dir); } catch { /* a file vanished mid-walk; the next poll sees the settled tree */ }
  return sig;
}

function watch(dir) {
  let last = signature(dir);
  return setInterval(() => {
    const now = signature(dir);
    if (now === last) return;
    last = now;
    clearTimeout(timer);
    timer = setTimeout(rebuild, 400);
  }, 800);
}

async function stop() {
  clearTimeout(timer);
  clearInterval(watcher);
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
  watcher = watch(dir);
  rebuild();
  return snapshot();
}

// The OS's own folder dialog, opened on this machine (Hostess and the browser are on the same
// computer; a web page can't learn a folder's real path). Resolves null when cancelled.
function pickFolder() {
  const { execFile } = require('child_process');
  const title = 'Choose an app folder to watch';
  const tries = {
    linux: [['zenity', ['--file-selection', '--directory', `--title=${title}`]], ['kdialog', ['--getexistingdirectory', require('os').homedir(), '--title', title]]],
    darwin: [['osascript', ['-e', `POSIX path of (choose folder with prompt "${title}")`]]],
    win32: [['powershell', ['-NoProfile', '-STA', '-Command', `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = '${title}'; if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }`]]],
  }[process.platform] || [];
  return new Promise((resolve, reject) => {
    const next = (i) => {
      if (i >= tries.length) return reject(new Error('No folder dialog available on this computer. Type the path instead.'));
      execFile(tries[i][0], tries[i][1], (err, out) => {
        if (err && err.code === 'ENOENT') return next(i + 1);
        resolve(out.trim().replace(/[\\/]$/, '') || null); // cancel exits non-zero with no output
      });
    };
    next(0);
  });
}

module.exports = {
  start, stop, rebuild, subscribe, pickFolder,
  status: () => ({ ...snapshot(), log: state.log, remembered: settings.get('workbenchDir') || '' }),
  // A container left over from before a restart has nothing watching it.
  cleanup: () => docker.stopAndRemove(CONTAINER).catch(() => {}),
};
