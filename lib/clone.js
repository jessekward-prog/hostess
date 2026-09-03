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
    await git(['clone', '--depth', '1', source, stagingDir]);
  }
  return stagingDir;
}

function promoteToFinal(stagingDir, name) {
  const finalDir = path.join(APPS_DIR, name);
  if (fs.existsSync(finalDir)) fs.rmSync(finalDir, { recursive: true, force: true });
  fs.renameSync(stagingDir, finalDir);
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
