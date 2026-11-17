const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const manifest = require('./manifest');
const docker = require('./docker');
const registry = require('./registry');
const postgres = require('./postgres');
const guard = require('./guard');
const describe = require('./describe');
const gateway = require('./gateway');
const search = require('./search');
const ntfy = require('./ntfy');
const settings = require('./settings');
const { fetchRepo, promoteToFinal, getLocalHeadSha } = require('./clone');

let portLock = Promise.resolve();
function withPortLock(fn) {
  const run = portLock.then(fn, fn);
  portLock = run.catch(() => {});
  return run;
}

// Keyed per app name so an autoupdate.js redeploy firing while a user
// triggers their own redeploy (or removeApp) of the same app can't interleave
// -- promoteToFinal's rm+rename of apps/<name> and the final `docker run
// --name selfhost-<name>` are only safe one-at-a-time per name. Different
// apps still run their deploys fully in parallel.
const appLocks = new Map();
function withAppLock(name, fn) {
  const prev = appLocks.get(name) || Promise.resolve();
  const run = prev.then(fn, fn);
  appLocks.set(name, run.catch(() => {}));
  return run;
}

// opts.guardVerdict: a security scan the caller already ran on this same source (Workbench launch), reused
// instead of scanning again.
async function deployApp(source, log = () => {}, emit = () => {}, opts = {}) {
  log(`Fetching ${source} ...`);
  const stagingDir = await fetchRepo(source);

  let app;
  try {
    app = manifest.load(stagingDir);
  } catch (err) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw err;
  }

  const readsPush = app.env.some((key) => key.startsWith('NTFY_'));
  emit({
    type: 'plan',
    name: app.name,
    steps: [
      { id: 'check', label: 'Checking the app' },
      { id: 'build', label: 'Building the image' },
      ...(readsPush ? [{ id: 'push', label: 'Setting up notifications' }] : []),
      ...(app.search ? [{ id: 'search', label: 'Starting the search service' }] : []),
      ...(app.postgres ? [{ id: 'db', label: 'Setting up the database' }] : []),
      { id: 'start', label: 'Starting the container' },
    ],
  });
  return withAppLock(app.name, () => deployStagedApp(app, stagingDir, source, log, emit, opts));
}

async function deployStagedApp(app, stagingDir, source, log, emit = () => {}, opts = {}) {
  const step = (id, state, extra) => emit({ type: 'step', id, state, ...extra });
  const repoDir = promoteToFinal(stagingDir, app.name);
  log(`Repo staged at ${repoDir} as "${app.name}"`);

  // Local-path sources get copied without .git (see clone.js), so there's no
  // commit to track — auto-update only makes sense for a real git remote.
  let commitSha = null;
  if (fs.existsSync(path.join(repoDir, '.git'))) {
    commitSha = await getLocalHeadSha(repoDir).catch(() => null);
  }

  step('check', 'active');
  const guardVerdict = opts.guardVerdict || await guard.scanRepo(repoDir, log);
  if (opts.guardVerdict) log(`Security guard: already checked (risk=${guardVerdict.risk}).`);
  if (guardVerdict.risk === 'high') {
    const findings = guardVerdict.findings.map((f) => `  - ${f.issue}: ${f.why}`).join('\n');
    throw new Error(`Security guard blocked this deploy (risk: high) — ${guardVerdict.summary}\n${findings}`);
  }

  step('check', 'done');

  const containerName = `selfhost-${app.name}`;
  const image = `selfhost-${app.name}:latest`;
  const existing = registry.get(app.name);

  if (existing) {
    log(`"${app.name}" already deployed — redeploying in place (same port, same container name).`);
    await docker.stopAndRemove(containerName);
  }

  let hostPort = existing ? existing.port : null;
  if (!hostPort) {
    hostPort = await withPortLock(async () => {
      const takenPorts = new Set(
        Object.values(registry.readAll())
          .filter((r) => r.port && r.name !== app.name)
          .map((r) => r.port)
      );
      const port = await docker.findFreePort(takenPorts);
      registry.upsert(app.name, { port });
      return port;
    });
  }

  let gatewayPort = existing ? existing.gatewayPort : null;
  if (app.publicGateway && !gatewayPort) {
    gatewayPort = await withPortLock(async () => {
      const takenPorts = new Set(
        Object.values(registry.readAll()).flatMap((r) => [r.port, r.gatewayPort].filter(Boolean))
      );
      const port = await docker.findFreePort(takenPorts);
      registry.upsert(app.name, { gatewayPort: port });
      return port;
    });
  } else if (!app.publicGateway && gatewayPort) {
    // Declaration was removed from app.yaml — stop tunneling it and drop the port.
    gateway.disable(app.name);
    gatewayPort = null;
  }

  log(`Building image ${image} ...`);
  step('build', 'active');
  let lastEmit = 0;
  await docker.buildImage(image, repoDir, (line) => {
    // BuildKit prefixes lines with "#8 " (and a timestamp for step output); show what it is doing right now.
    const text = line.replace(/^#\d+\s+(?:[\d.]+\s+)?/, '').trim();
    if (text && Date.now() - lastEmit > 120) {
      lastEmit = Date.now();
      step('build', 'active', { detail: text.slice(0, 90) });
    }
  });
  step('build', 'done');

  await postgres.ensureNetwork();

  // SYNC_SECRET only needs both sides to agree on a random string, and Hostess
  // is always one of those sides -- so unlike a real third-party API key,
  // there's no reason to make the user think about it. Auto-generate it once
  // and keep reusing the same value on redeploy, the same way Postgres
  // passwords already are.
  let env0SearchUrl = null;
  let envValues = { ...((existing && existing.envValues) || {}) };
  if (app.env.includes('SYNC_SECRET') && !envValues.SYNC_SECRET) {
    envValues.SYNC_SECRET = crypto.randomBytes(16).toString('hex');
    log(`Generated a SYNC_SECRET for "${app.name}" automatically (enables Hostess's ai link / other sync features).`);
  }

  // Fleet-wide values Hostess already holds (settings.json): any app that reads
  // these names gets them for free, the same way postgres:true auto-injects
  // DATABASE_URL, instead of the operator retyping the same URL/key into every
  // app's env panel by hand. An operator-set value (env panel) always wins and
  // is never overwritten.
  const injectFleet = (vars, what) => {
    const injected = [];
    for (const [key, value] of Object.entries(vars)) {
      if (app.env.includes(key) && !envValues[key] && value) {
        envValues[key] = value;
        injected.push(key);
      }
    }
    if (injected.length) log(`Wired "${app.name}" to ${what} automatically (${injected.join(', ')}).`);
  };
  // The fleet has exactly one LM Studio ("the library"); Hostess holds its
  // address for the security guard's own scans anyway.
  injectFleet({ LM_STUDIO_URL: settings.get('lmUrl'), LM_STUDIO_API_KEY: settings.get('lmApiKey'), LM_STUDIO_MODEL: settings.get('lmModel') }, 'the library');
  // Push is platform-owned, like DATABASE_URL: Hostess runs the one push server (lib/ntfy.js) and
  // sets NTFY_* itself, so the card can't point an app anywhere else. A push problem never fails
  // the deploy: the app just runs with push off (RULES.html §2).
  const readsPush = app.env.some((key) => key.startsWith('NTFY_'));
  let push = {};
  if (readsPush) {
    step('push', 'active');
    try { push = await ntfy.ensure(log); } catch (err) { log(`Push server unavailable, deploying without it: ${err.message}`); }
    step('push', 'done');
  }
  // values typed or injected before push was platform-owned
  for (const key of Object.keys(envValues)) if (key.startsWith('NTFY_')) delete envValues[key];

  // Provisioned before the container starts so SEARXNG_URL is present at boot.
  // Kept off selfhost-net on purpose — see lib/search.js for why.
  if (app.search) {
    step('search', 'active');
    env0SearchUrl = await search.ensure(log);
    step('search', 'done');
  }

  let env = { ...envValues };
  let dbPassword;
  // Platform-owned, like DATABASE_URL: the app never configures where search
  // lives, so it can't be pointed somewhere hostile by its own config.
  if (env0SearchUrl) env.SEARXNG_URL = env0SearchUrl;
  if (env.LM_STUDIO_URL) env.LM_STUDIO_URL = docker.containerUrl(env.LM_STUDIO_URL);
  if (push.url) {
    Object.assign(env, { NTFY_URL: push.url, NTFY_TOKEN: push.token, NTFY_TOPIC: push.topic });
    log(`Wired "${app.name}" to the push server.`);
  }

  if (app.postgres) {
    step('db', 'active');
    log(`Provisioning Postgres database for "${app.name}" ...`);
    const { databaseUrl, rolePassword, dbHost, dbPort, dbName, dbUser } = await postgres.provisionDatabase(app.name, existing && existing.dbPassword);
    env.DATABASE_URL = databaseUrl;
    env.DB_HOST = dbHost;
    env.DB_PORT = String(dbPort);
    env.DB_NAME = dbName;
    env.DB_USER = dbUser;
    env.DB_PASSWORD = rolePassword;
    dbPassword = rolePassword;
    step('db', 'done');
  }

  // A named volume survives `docker rm` (stopAndRemove above), unlike the
  // container's own writable layer — without this, anything an app writes
  // to disk (uploads, local file storage) vanishes on every redeploy while
  // its Postgres rows keep pointing at files that no longer exist.
  const dataVolume = app.dataDir ? `selfhost-${app.name}-data` : null;

  // Must exist (owned by us) before `docker run` sees the -v flag below —
  // otherwise the Docker daemon (root) auto-creates it on first use and this
  // process can never write the gateway URL file into it again.
  const gatewayDir = app.publicGateway ? path.join(__dirname, '..', 'apps', app.name, '.gateway') : null;
  if (gatewayDir) fs.mkdirSync(gatewayDir, { recursive: true });

  step('start', 'active');
  log(`Starting container ${containerName} on http://localhost:${hostPort} ...`);
  await docker.runContainer({
    name: containerName,
    image,
    network: postgres.NETWORK,
    hostPort,
    containerPort: app.port,
    gatewayHostPort: gatewayPort,
    gatewayContainerPort: app.publicGateway && app.publicGateway.port,
    gatewayDir,
    env,
    dataDir: app.dataDir,
    dataVolume,
  });

  if (app.search) {
    await docker.connectNetwork(search.NETWORK, containerName);
    log(`"${app.name}" joined the search network.`);
  }
  // The built-in push server sits on its own network, like search; only apps that use it join.
  if (readsPush && push.network) {
    await docker.connectNetwork(push.network, containerName);
    log(`"${app.name}" joined the push network.`);
  }

  const record = registry.upsert(app.name, {
    repoSource: source,
    containerName,
    image,
    port: hostPort,
    containerPort: app.port,
    gatewayPort,
    gatewayContainerPort: app.publicGateway ? app.publicGateway.port : null,
    postgres: app.postgres,
    search: app.search,
    autoUpdate: app.autoUpdate,
    commitSha,
    envVars: app.env,
    envValues,
    dbPassword,
    dataDir: app.dataDir,
    dataVolume,
    guard: guardVerdict,
    // app.yaml's description/icon are the source of truth once declared;
    // fall back to whatever a previous AI "scrape" found so redeploying
    // without either field doesn't blank out an existing good result.
    description: app.description || (existing && existing.description) || null,
    logo: app.icon || (existing && existing.logo) || null,
  });

  // If this redeploy dropped the declaration, don't leave an internet-facing
  // container running on a machine that no longer wants one.
  if (!app.search) await search.removeIfUnused(log).catch(() => {});

  step('start', 'done');
  log(`"${app.name}" is running at http://localhost:${hostPort}`);
  return record;
}

async function redeployApp(name, log = () => {}, emit = () => {}) {
  const record = registry.get(name);
  if (!record) throw new Error(`No such app: ${name}`);
  return deployApp(record.repoSource, log, emit);
}

async function stopApp(name) {
  const record = registry.get(name);
  if (!record) throw new Error(`No such app: ${name}`);
  await docker.run(['stop', record.containerName]);
}

async function startApp(name) {
  const record = registry.get(name);
  if (!record) throw new Error(`No such app: ${name}`);
  await docker.run(['start', record.containerName]);
}

async function removeApp(name) {
  const record = registry.get(name);
  if (!record) throw new Error(`No such app: ${name}`);
  return withAppLock(name, async () => {
    await docker.stopAndRemove(record.containerName);
    fs.rmSync(path.join(__dirname, '..', 'apps', name), { recursive: true, force: true });
    // An uploaded app's saved copy (lib/import.js) goes with it, or the folder is orphaned forever.
    fs.rmSync(path.join(__dirname, '..', 'imports', name), { recursive: true, force: true });
    registry.remove(name);
    await search.removeIfUnused().catch(() => {});
  });
}

async function listApps() {
  const all = registry.readAll();
  // Internal registry rows (Postgres admin creds, the search backend's secret
  // key) aren't apps and have no matching container -- listing them shows a
  // broken-looking card for something that was never meant to be deployable.
  const names = Object.keys(all).filter((n) => !n.startsWith('__'));
  const results = [];
  for (const name of names) {
    const { envValues, ...record } = all[name];
    const status = await docker.containerStatus(record.containerName).catch(() => 'unknown');
    // Names Hostess fills in itself never get an input on the card: nobody should type them.
    const envVars = (record.envVars || []).filter((key) => !key.startsWith('NTFY_') && key !== 'SYNC_SECRET');
    results.push({ ...record, envVars, status, envSet: Object.keys(envValues || {}) });
  }
  return results;
}

async function setEnvValues(name, values) {
  const record = registry.get(name);
  if (!record) throw new Error(`No such app: ${name}`);
  const envValues = { ...(record.envValues || {}) };
  for (const [key, value] of Object.entries(values)) {
    if (value === '') delete envValues[key];
    else envValues[key] = value;
  }
  registry.upsert(name, { envValues });
  return { name, envSet: Object.keys(envValues) };
}

async function scanApp(name, log = () => {}) {
  const record = registry.get(name);
  if (!record) throw new Error(`No such app: ${name}`);
  const repoDir = path.join(__dirname, '..', 'apps', name);
  const guardVerdict = await guard.scanRepo(repoDir, log);
  return registry.upsert(name, { guard: guardVerdict });
}

async function getLogs(name, tailLines = 200) {
  const record = registry.get(name);
  if (!record) throw new Error(`No such app: ${name}`);
  return docker.logs(record.containerName, tailLines);
}

async function describeApp(name) {
  const record = registry.get(name);
  if (!record) throw new Error(`No such app: ${name}`);
  const repoDir = path.join(__dirname, '..', 'apps', name);
  const { logo, description } = await describe.describeApp(repoDir, name);
  return registry.upsert(name, { logo, description });
}

// What Hostess can safely throw away: Docker's build cache, untagged ("dangling") image layers, and
// half-finished staging folders from deploys that died. Running apps, volumes and data are untouched.
// In-flight deploys use fresh staging folders, so only ones over an hour old go.
async function clearCaches() {
  const build = await docker.run(['builder', 'prune', '-f']);
  const images = await docker.run(['image', 'prune', '-f']);
  let staleDirs = 0;
  for (const [dir, prefix] of [['apps', '_staging-'], ['imports', '_tmp-']]) {
    const base = path.join(__dirname, '..', dir);
    if (!fs.existsSync(base)) continue;
    for (const entry of fs.readdirSync(base)) {
      const full = path.join(base, entry);
      if (entry.startsWith(prefix) && Date.now() - fs.statSync(full).mtimeMs > 3600e3) {
        fs.rmSync(full, { recursive: true, force: true });
        staleDirs++;
      }
    }
  }
  return {
    buildCache: (/Total:\s*(\S+)/.exec(build) || [])[1] || '0B',
    images: (/reclaimed space:\s*(\S+)/i.exec(images) || [])[1] || '0B',
    staleDirs,
  };
}

module.exports = { clearCaches, deployApp, redeployApp, stopApp, startApp, removeApp, listApps, getLogs, scanApp, setEnvValues, describeApp };
