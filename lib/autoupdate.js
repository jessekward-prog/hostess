const fs = require('fs');
const registry = require('./registry');
const engine = require('./engine');
const { getRemoteHeadSha } = require('./clone');

const CHECK_INTERVAL_MS = 10 * 60 * 1000;

// Only real git remotes have something to poll -- a local-path source was
// copied in without .git (see clone.js) and has no upstream to check.
function isGitRemote(source) {
  return !fs.existsSync(source);
}

async function checkOne(name, record, log) {
  if (!record.autoUpdate || !isGitRemote(record.repoSource)) return;
  let latestSha;
  try {
    latestSha = await getRemoteHeadSha(record.repoSource);
  } catch (err) {
    log(`[auto-update] "${name}": couldn't check ${record.repoSource} (${err.message})`);
    return;
  }
  if (!record.commitSha || latestSha === record.commitSha) return;

  log(`[auto-update] "${name}": new commit detected, redeploying ...`);
  try {
    await engine.redeployApp(name, (line) => log(`[auto-update] "${name}": ${line}`));
  } catch (err) {
    log(`[auto-update] "${name}": redeploy failed (${err.message})`);
  }
}

async function checkAll(log = console.log) {
  const all = registry.readAll();
  for (const [name, record] of Object.entries(all)) {
    if (name === '__postgres__') continue;
    await checkOne(name, record, log);
  }
}

function start(log = console.log) {
  checkAll(log).catch((err) => log(`[auto-update] check failed: ${err.message}`));
  setInterval(() => {
    checkAll(log).catch((err) => log(`[auto-update] check failed: ${err.message}`));
  }, CHECK_INTERVAL_MS);
}

module.exports = { start, checkAll };
