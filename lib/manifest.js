const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/;

// Fleet-wide naming convention for AI connection vars (LM_STUDIO_URL and its
// siblings, ANTHROPIC_API_KEY, plus SYNC_SECRET once an app implements the
// /api/lm sync pattern — see lib/ailink.js). Scanning source instead of
// requiring every app.yaml to spell these out means the env panel (and, once
// SYNC_SECRET is actually set and the app answers, the ai-link section) show
// up automatically for any app that uses them, with zero manifest edits.
const AI_ENV_VAR_RE = /\bLM_STUDIO_[A-Z_]+\b|\bANTHROPIC_API_KEY\b|\bOPENAI_API_KEY\b|\bSYNC_SECRET\b/g;
const SCAN_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'apps']);
const SCAN_FILE_RE = /\.(js|mjs|cjs|ts)$/;

function detectAiEnvVars(repoDir) {
  const found = new Set();
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (SCAN_SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!SCAN_FILE_RE.test(entry.name)) continue;
      let text;
      try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
      const matches = text.match(AI_ENV_VAR_RE);
      if (matches) matches.forEach((m) => found.add(m));
    }
  }
  walk(repoDir);
  return [...found];
}

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

  const declaredEnv = Array.isArray(raw.env) ? raw.env.filter((v) => typeof v === 'string') : [];
  const env = [...new Set([...declaredEnv, ...detectAiEnvVars(repoDir)])];

  return {
    name: raw.name,
    port: raw.port,
    postgres: raw.postgres === true,
    env,
  };
}

module.exports = { load };
