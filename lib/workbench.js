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
        // Same plan/step events a deploy sends, so the page's CRT monitor can show them.
        const step = (id, st) => emit({ type: 'step', id, state: st });
        emit({ type: 'plan', name: app.name, steps: [
          { id: 'build', label: 'Building the image' },
          ...(app.postgres ? [{ id: 'db', label: 'Setting up its database' }] : []),
          { id: 'start', label: 'Starting it up' },
          { id: 'answer', label: 'Waiting for it to answer' },
        ] });
        step('build', 'active');
        log(`Building ${app.name} from ${dir} ...`);
        await docker.buildImage(`${CONTAINER}:latest`, dir, log);
        step('build', 'done');
        if (dir !== state.dir) continue; // switched folders mid-build
        // Its own database (wb-<name>), never the installed app's: provisioning reuses a role's
        // password only if we pass it, and a real install's would otherwise be rotated.
        let env = {};
        if (app.postgres) {
          step('db', 'active');
          const db = await postgres.provisionDatabase(`wb-${app.name}`, dbPasswords.get(app.name));
          dbPasswords.set(app.name, db.rolePassword);
          env = { DATABASE_URL: db.databaseUrl, DB_HOST: db.dbHost, DB_PORT: String(db.dbPort), DB_NAME: db.dbName, DB_USER: db.dbUser, DB_PASSWORD: db.rolePassword };
          log(`Database ready (${db.dbName}).`);
          step('db', 'done');
        }
        step('start', 'active');
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
        step('start', 'done');
        step('answer', 'active');
        log(`Started on http://127.0.0.1:${state.port}, waiting for it to answer ...`);
        if (!(await waitForPort(state.port))) {
          const out = await containerLogs();
          throw new Error(`The app didn't answer on port ${app.port} inside the container.${out ? `\n${out}` : ''}`);
        }
        step('answer', 'done');
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

// Prompt builder: the local model turns a rough request into a prompt for a bigger coding model,
// grounded in what's actually in the watched folder so it doesn't have to guess the stack.
function folderContext() {
  const dir = state.dir;
  const read = (f, max) => { try { const t = fs.readFileSync(path.join(dir, f), 'utf8'); return t.length > max ? `${t.slice(0, max)}\n...(cut)` : t; } catch { return null; } };
  const tree = [];
  const walk = (d, depth) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, e.name);
      if (IGNORE.test(full) || e.name.startsWith('.') || /^(dist|build|uploads|data)$/.test(e.name) || tree.length >= 150) continue;
      tree.push(`${'  '.repeat(depth)}${e.name}${e.isDirectory() ? '/' : ''}`);
      if (e.isDirectory() && depth < 2) walk(full, depth + 1);
    }
  };
  try { walk(dir, 0); } catch { /* unreadable folder: send what we have */ }
  let pkg = null;
  try { const j = JSON.parse(read('package.json', 1e6)); pkg = { scripts: j.scripts, dependencies: Object.keys(j.dependencies || {}), devDependencies: Object.keys(j.devDependencies || {}) }; } catch { /* not a node app */ }
  return [
    `Folder: ${dir}`,
    `app.yaml:\n${read('app.yaml', 2000) || '(none, served as static files)'}`,
    pkg && `package.json: ${JSON.stringify(pkg)}`,
    `Files:\n${tree.join('\n')}`,
    read('README.md', 1500) && `README (start):\n${read('README.md', 1500)}`,
    state.status === 'error' && `The live preview is currently failing:\n${state.log.slice(-25).join('\n')}`,
  ].filter(Boolean).join('\n\n');
}

const REFINE_SYSTEM = `You turn a developer's rough request into one excellent prompt for a strong AI coding agent (such as Claude Code) that has full access to the app's folder.

Write the prompt in this order, in plain English, using short headings:
1. Goal: one or two sentences, what to change and why, in the developer's terms.
2. Context: the folder path, the stack and the files most likely involved, taken ONLY from the folder facts given. Never invent files, libraries or features.
3. Requirements: concrete numbered points, including edge cases and empty, error and mobile states that the request implies.
4. Constraints: keep the change small and in the existing style; keep it deployable on Hostess (app.yaml + Dockerfile at the root, the app listens on the app.yaml port, user data only under dataDir); add no new dependency unless needed.
5. Done when: checks the agent must actually run or look at to prove it works. The app is shown live in Hostess Workbench at phone (390px) and desktop (1280px) widths and rebuilds on every save, so ask for both widths to be checked.
6. Unclear: assumptions you made, as questions the agent should confirm only if they would change the result. Omit this heading if there are none.

Keep everything the developer asked for and add nothing they didn't imply. If the preview is failing and the request is about that, make fixing that error the goal and quote the key error lines.
Reply with the prompt only: no preamble, no closing remarks, no code fences around it.`;

async function refinePrompt(request, onText, signal) {
  if (!state.dir) throw new Error('Watch an app folder first, so the prompt can describe it.');
  const { url, apiKey, model } = require('./guard').lmConfig();
  if (!url) throw new Error('No local AI connected. Set one up under MY AI on the dashboard.');
  const res = await fetch(`${url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(apiKey && { Authorization: `Bearer ${apiKey}` }) },
    // No max_tokens: reasoning models return nothing when the budget is spent thinking.
    body: JSON.stringify({ model: model || undefined, stream: true, temperature: 0.3, messages: [
      { role: 'system', content: REFINE_SYSTEM },
      { role: 'user', content: `Folder facts:\n${folderContext()}\n\nThe developer's request:\n${request}` },
    ] }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(300000)]),
  });
  if (!res.ok) throw new Error(`The local AI answered HTTP ${res.status}`);
  // Hide inline <think>...</think>: only the answer is the prompt.
  let raw = '', shown = 0, buf = '';
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data:') || line.includes('[DONE]')) continue;
      try { raw += JSON.parse(line.slice(5)).choices?.[0]?.delta?.content || ''; } catch { continue; }
      let visible = raw.replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/^\s+/, '');
      // A tag can arrive split across chunks ("<thi" + "nk>"): hold back a tail that could still start one.
      for (let k = 6; k > 0; k--) if (visible.endsWith('<think>'.slice(0, k))) { visible = visible.slice(0, -k); break; }
      if (visible.length > shown) { onText(visible.slice(shown)); shown = visible.length; }
    }
  }
  if (!shown) throw new Error('The local AI returned no text. Try again, or pick a different model under MY AI.');
}

module.exports = {
  start, stop, rebuild, subscribe, pickFolder, refinePrompt,
  status: () => ({ ...snapshot(), log: state.log, remembered: settings.get('workbenchDir') || '' }),
  // A container left over from before a restart has nothing watching it.
  cleanup: () => docker.stopAndRemove(CONTAINER).catch(() => {}),
};
