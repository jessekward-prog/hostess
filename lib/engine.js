const fs = require('fs');
const manifest = require('./manifest');
const docker = require('./docker');
const registry = require('./registry');
const postgres = require('./postgres');
const guard = require('./guard');
const { fetchRepo, promoteToFinal } = require('./clone');

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

  const guardVerdict = await guard.scanRepo(repoDir, log);
  if (guardVerdict.risk === 'high') {
    const findings = guardVerdict.findings.map((f) => `  - ${f}`).join('\n');
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
    const takenPorts = new Set(
      Object.values(registry.readAll())
        .filter((r) => r.port && r.name !== app.name)
        .map((r) => r.port)
    );
    hostPort = await docker.findFreePort(takenPorts);
    registry.upsert(app.name, { port: hostPort });
  }

  log(`Building image ${image} ...`);
  await docker.buildImage(image, repoDir);

  await postgres.ensureNetwork();

  let env = {};
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
    envVars: app.env,
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
  const path = require('path');
  fs.rmSync(path.join(__dirname, '..', 'apps', name), { recursive: true, force: true });
  registry.remove(name);
}

async function listApps() {
  const all = registry.readAll();
  const names = Object.keys(all).filter((n) => n !== '__postgres__');
  const results = [];
  for (const name of names) {
    const record = all[name];
    const status = await docker.containerStatus(record.containerName).catch(() => 'unknown');
    results.push({ ...record, status });
  }
  return results;
}

async function getLogs(name, tailLines = 200) {
  const record = registry.get(name);
  if (!record) throw new Error(`No such app: ${name}`);
  return docker.logs(record.containerName, tailLines);
}

module.exports = { deployApp, redeployApp, stopApp, startApp, removeApp, listApps, getLogs };
