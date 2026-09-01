const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/;

function load(repoDir) {
  const manifestPath = path.join(repoDir, 'app.yaml');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing app.yaml at repo root (${manifestPath}). Every deployable repo needs one — see README for the format.`);
  }
  const raw = yaml.load(fs.readFileSync(manifestPath, 'utf8')) || {};

  if (!raw.name || !NAME_RE.test(raw.name)) {
    throw new Error(`app.yaml: "name" must be lowercase letters/numbers/hyphens, 2-50 chars (got: ${JSON.stringify(raw.name)})`);
  }
  if (!Number.isInteger(raw.port) || raw.port <= 0 || raw.port > 65535) {
    throw new Error(`app.yaml: "port" must be an integer 1-65535 (got: ${JSON.stringify(raw.port)})`);
  }
  if (!fs.existsSync(path.join(repoDir, 'Dockerfile'))) {
    throw new Error(`Repo has no Dockerfile at its root — required alongside app.yaml.`);
  }

  return {
    name: raw.name,
    port: raw.port,
    postgres: raw.postgres === true,
    env: Array.isArray(raw.env) ? raw.env.filter((v) => typeof v === 'string') : [],
  };
}

module.exports = { load };
