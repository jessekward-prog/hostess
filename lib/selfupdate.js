const path = require('path');
const { execFile, spawn } = require('child_process');
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
  return new Promise((resolve, reject) => {
    execFile('npm', args, { cwd: ROOT }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}

async function check(log) {
  let remote;
  try {
    remote = await getRemoteHeadSha(REPO_URL);
  } catch (err) {
    log(`[self-update] couldn't reach remote: ${err.message}`);
    return;
  }

  const local = await getLocalHeadSha(ROOT);
  if (remote === local) return;

  log(`[self-update] new version detected, updating...`);
  try {
    await git(['pull', '--ff-only']);
    await npm(['install', '--omit=dev']);
    log(`[self-update] update applied, restarting...`);
    // Detached so systemd can kill this process and start the new one cleanly
    spawn('systemctl', ['--user', 'restart', 'hostess'], { detached: true, stdio: 'ignore' }).unref();
  } catch (err) {
    log(`[self-update] update failed: ${err.message}`);
  }
}

function start(log = console.log) {
  check(log).catch((err) => log(`[self-update] check failed: ${err.message}`));
  setInterval(() => {
    check(log).catch((err) => log(`[self-update] check failed: ${err.message}`));
  }, CHECK_INTERVAL_MS);
}

module.exports = { start };
