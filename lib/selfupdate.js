const path = require('path');
const { execFile } = require('child_process');
const { getRemoteHeadSha, getLocalHeadSha } = require('./clone');

const ROOT = path.join(__dirname, '..');
const REPO_URL = 'https://github.com/jessekward-prog/hostess.git';
const CHECK_INTERVAL_MS = 10 * 60 * 1000;

function git(args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: ROOT }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}

function npm(args) {
  const isWin = process.platform === 'win32';
  return new Promise((resolve, reject) => {
    execFile(isWin ? 'npm.cmd' : 'npm', args, { cwd: ROOT, shell: isWin }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}

// Pull and reinstall if GitHub is ahead. Resolves { changed, from, to }; the caller restarts.
async function apply(log = () => {}) {
  const remote = await getRemoteHeadSha(REPO_URL);
  const local = await getLocalHeadSha(ROOT);
  if (remote === local) return { changed: false, from: local, to: local };
  log(`[self-update] new version detected, updating...`);
  await git(['pull', '--ff-only']);
  await npm(['install', '--omit=dev']);
  return { changed: true, from: local, to: remote };
}

// A nonzero exit is the one restart signal every install target reacts to:
// systemd's Restart=on-failure only fires on failure exits, and launchd's
// KeepAlive relaunches regardless — no need to know which service manager
// (or none, e.g. Windows' service wrapper) is actually running this.
const restart = () => process.exit(1);

async function check(log) {
  let r;
  try {
    r = await apply(log);
  } catch (err) {
    log(`[self-update] ${err.message}`);
    return;
  }
  if (r.changed) {
    log(`[self-update] update applied, restarting...`);
    restart();
  }
}

function start(log = console.log) {
  check(log).catch((err) => log(`[self-update] check failed: ${err.message}`));
  setInterval(() => {
    check(log).catch((err) => log(`[self-update] check failed: ${err.message}`));
  }, CHECK_INTERVAL_MS);
}

module.exports = { start, apply, restart };
