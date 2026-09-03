const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const manifest = require('./manifest');
const docker = require('./docker');
const registry = require('./registry');
const postgres = require('./postgres');
const guard = require('./guard');
const { fetchRepo, promoteToFinal, getLocalHeadSha } = require('./clone');

let portLock = Promise.resolve();
function withPortLock(fn) {
  const run = portLock.then(fn, fn);
  portLock = run.catch(() => {});
  return run;
}

async function deployApp(source, log = () => {}) {
  log(`Fetching ${source} ...`);
  const stagingDir = await fetchRepo(source);

  let app;
  try {
    app = manifest.load(stagingDir);
  } catch (err) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw err;
  }

  const repoDir = promoteToFinal(stagingDir, app.name);
  log(`Repo staged at ${repoDir} as "${app.name}"`);

  // Local-path sources get copied without .git (see clone.js), so there's no
  // commit to track — auto-update only makes sense for a real git remote.
  let commitSha = null;
  if (fs.existsSync(path.join(repoDir, '.git'))) {
    commitSha = await getLocalHeadSha(repoDir).catch(() => null);
  }

  const guardVerdict = await guard.scanRepo(repoDir, log);
  if (guardVerdict.risk === 'high') {
    const findings = guardVerdict.findings.map((f) => `  - ${f.issue}: ${f.why}`).join('\n');
    throw new Error(`Security guard blocked this deploy (risk: high) — ${guardVerdict.summary}\n${findings}`);
  }

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

  log(`Building image ${image} ...`);
  await docker.buildImage(image, repoDir);

  await postgres.ensureNetwork();

  // SYNC_SECRET only needs both sides to agree on a random string, and Hostess
  // is always one of those sides -- so unlike a real third-party API key,
  // there's no reason to make the user think about it. Auto-generate it once
  // and keep reusing the same value on redeploy, the same way Postgres
  // passwords already are.
  let envValues = { ...((existing && existing.envValues) || {}) };
  if (app.env.includes('SYNC_SECRET') && !envValues.SYNC_SECRET) {
    envValues.SYNC_SECRET = crypto.randomBytes(16).toString('hex');
    log(`Generated a SYNC_SECRET for "${app.name}" automatically (enables Hostess's ai link / other sync features).`);
  }

  let env = { ...envValues };
  let dbPassword;
  if (app.postgres) {
    log(`Provisioning Postgres database for "${app.name}" ...`);
    const { databaseUrl, rolePassword, dbHost, dbPort, dbName, dbUser } = await postgres.provisionDatabase(app.name, existing && existing.dbPassword);
    env.DATABASE_URL = databaseUrl;
    env.DB_HOST = dbHost;
    env.DB_PORT = String(dbPort);
    env.DB_NAME = dbName;
    env.DB_USER = dbUser;
    env.DB_PASSWORD = rolePassword;
    dbPassword = rolePassword;
  }

  log(`Starting container ${containerName} on http://localhost:${hostPort} ...`);
  await docker.runContainer({
    name: containerName,
    image,
    network: postgres.NETWORK,
    hostPort,
    containerPort: app.port,
    env,
  });

  const record = registry.upsert(app.name, {
    repoSource: source,
    containerName,
    image,
    port: hostPort,
    containerPort: app.port,
    postgres: app.postgres,
    autoUpdate: app.autoUpdate,
    commitSha,
    envVars: app.env,
    envValues,
    dbPassword,
    guard: guardVerdict,
  });

  log(`"${app.name}" is running at http://localhost:${hostPort}`);
  return record;
}

async function redeployApp(name, log = () => {}) {
  const record = registry.get(name);
  if (!record) throw new Error(`No such app: ${name}`);
  return deployApp(record.repoSource, log);
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
  await docker.stopAndRemove(record.containerName);
  fs.rmSync(path.join(__dirname, '..', 'apps', name), { recursive: true, force: true });
  registry.remove(name);
}

async function listApps() {
  const all = registry.readAll();
  const names = Object.keys(all).filter((n) => n !== '__postgres__');
  const results = [];
  for (const name of names) {
    const { envValues, ...record } = all[name];
    const status = await docker.containerStatus(record.containerName).catch(() => 'unknown');
    results.push({ ...record, status, envSet: Object.keys(envValues || {}) });
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

module.exports = { deployApp, redeployApp, stopApp, startApp, removeApp, listApps, getLogs, scanApp, setEnvValues };
