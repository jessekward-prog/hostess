const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const APPS_DIR = path.join(__dirname, '..', 'apps');

function git(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}

// source can be a git URL or a local path — caller decides which by inspection.
async function fetchRepo(source) {
  const isLocalPath = fs.existsSync(source);
  const stagingName = `_staging-${Date.now()}`;
  const stagingDir = path.join(APPS_DIR, stagingName);

  if (isLocalPath) {
    fs.cpSync(source, stagingDir, { recursive: true, filter: (src) => !src.includes(`${path.sep}.git${path.sep}`) && !src.endsWith(`${path.sep}.git`) });
  } else {
    // autocrlf off: Git for Windows would otherwise check shell scripts out with CRLF, which
    // the Linux container cannot execute.
    await git(['clone', '-c', 'core.autocrlf=false', '--depth', '1', source, stagingDir]);
  }
  return stagingDir;
}

function promoteToFinal(stagingDir, name) {
  const finalDir = path.join(APPS_DIR, name);
  // Windows antivirus and indexers briefly hold handles on a fresh clone, which fails both calls
  // with EPERM/EBUSY. Retry for about a second before giving up.
  if (fs.existsSync(finalDir)) fs.rmSync(finalDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(stagingDir, finalDir);
      break;
    } catch (err) {
      if (attempt === 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250); // ponytail: blocking sleep, at most 1s total
    }
  }
  return finalDir;
}

// Cheap check for auto-update polling — no clone, just asks the remote what
// its default branch currently points at. Local-path sources have no remote
// to ask, so callers should skip those (see lib/autoupdate.js).
async function getRemoteHeadSha(source) {
  const out = await git(['ls-remote', source, 'HEAD']);
  const sha = out.split(/\s+/)[0];
  if (!sha) throw new Error(`Couldn't read HEAD from ${source}`);
  return sha;
}

async function getLocalHeadSha(repoDir) {
  return git(['rev-parse', 'HEAD'], repoDir);
}

module.exports = { fetchRepo, promoteToFinal, getRemoteHeadSha, getLocalHeadSha, APPS_DIR };
