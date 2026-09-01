const crypto = require('crypto');
const docker = require('./docker');

const NETWORK = 'selfhost-net';
const PG_CONTAINER = 'selfhost-postgres';
const PG_IMAGE = 'postgres:16-alpine';
const PG_ADMIN_USER = 'postgres';

function readAdminPassword() {
  const registry = require('./registry');
  const meta = registry.get('__postgres__');
  return meta && meta.adminPassword;
}

async function ensureNetwork() {
  await docker.ensureNetwork(NETWORK);
}

async function ensureSharedPostgres() {
  await ensureNetwork();
  const registry = require('./registry');

  let meta = registry.get('__postgres__');
  if (!meta) {
    meta = registry.upsert('__postgres__', { adminPassword: crypto.randomBytes(24).toString('hex') });
  }

  if (await docker.containerExists(PG_CONTAINER)) {
    const status = await docker.containerStatus(PG_CONTAINER);
    if (status !== 'running') await docker.run(['start', PG_CONTAINER]);
    return meta.adminPassword;
  }

  await docker.run([
    'run', '-d',
    '--name', PG_CONTAINER,
    '--network', NETWORK,
    '--restart', 'unless-stopped',
    '-e', `POSTGRES_PASSWORD=${meta.adminPassword}`,
    '-v', 'selfhost-pgdata:/var/lib/postgresql/data',
    PG_IMAGE,
  ]);

  await waitForReady();
  return meta.adminPassword;
}

async function waitForReady(retries = 20) {
  for (let i = 0; i < retries; i++) {
    try {
      await docker.run(['exec', PG_CONTAINER, 'pg_isready', '-U', PG_ADMIN_USER]);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error('Shared Postgres container did not become ready in time');
}

function sqlIdent(name) {
  // app names are already restricted to [a-z0-9-]; swap hyphens for underscores for valid SQL identifiers
  return name.replace(/-/g, '_');
}

// Pass `existingPassword` on redeploy so the role's password (and thus DATABASE_URL)
// stays stable instead of rotating on every deploy.
async function provisionDatabase(appName, existingPassword) {
  const adminPassword = await ensureSharedPostgres();
  const dbName = `app_${sqlIdent(appName)}`;
  const roleName = `app_${sqlIdent(appName)}`;
  const rolePassword = existingPassword || crypto.randomBytes(24).toString('hex');

  const psql = (sql) => docker.run([
    'exec', '-e', `PGPASSWORD=${adminPassword}`, PG_CONTAINER,
    'psql', '-U', PG_ADMIN_USER, '-tAc', sql,
  ]);

  const roleExists = await psql(`SELECT 1 FROM pg_roles WHERE rolname='${roleName}'`);
  if (!roleExists.trim()) {
    await psql(`CREATE ROLE ${roleName} LOGIN PASSWORD '${rolePassword}'`);
  } else if (!existingPassword) {
    await psql(`ALTER ROLE ${roleName} PASSWORD '${rolePassword}'`);
  }

  const dbExists = await psql(`SELECT 1 FROM pg_database WHERE datname='${dbName}'`);
  if (!dbExists.trim()) {
    await psql(`CREATE DATABASE ${dbName} OWNER ${roleName}`);
  }

  return {
    network: NETWORK,
    rolePassword,
    databaseUrl: `postgres://${roleName}:${rolePassword}@${PG_CONTAINER}:5432/${dbName}`,
    // Some apps read discrete DB_* vars instead of a single connection string —
    // provide both so either convention works without the app needing to change.
    dbHost: PG_CONTAINER,
    dbPort: 5432,
    dbName,
    dbUser: roleName,
    dbPassword: rolePassword,
  };
}

module.exports = { ensureNetwork, ensureSharedPostgres, provisionDatabase, NETWORK, PG_CONTAINER };
