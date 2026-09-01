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

module.exports = { fetchRepo, promoteToFinal, APPS_DIR };
