const fs = require('fs');
const path = require('path');
const guard = require('./guard');

// Reuses guard.js's MY AI settings (same LM Studio endpoint that already
// powers the pre-deploy security scan) rather than adding a second config UI.
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next']);
const ICON_NAME_RE = /^(icon|logo|favicon|apple-touch-icon)[-.]?.*\.(svg|png|ico)$/i;

function iconRank(name) {
  const n = name.toLowerCase();
  if (n === 'icon.svg' || n === 'logo.svg') return 0;
  if (n.includes('512')) return 1;
  if (n.includes('logo')) return 2;
  if (n.includes('192')) return 3;
  if (n.includes('apple-touch')) return 4;
  if (n.includes('32')) return 5;
  return 6;
}

// Apps scaffold their icon in different spots (repo root, public/, a nested
// frontend dir) — walk a few levels rather than guessing one fixed path.
function findLogo(repoDir) {
  let best = null;
  let bestRank = Infinity;
  function walk(dir, depth) {
    if (depth > 4) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name), depth + 1);
        continue;
      }
      if (!ICON_NAME_RE.test(entry.name)) continue;
      const rank = iconRank(entry.name);
      if (rank < bestRank) { bestRank = rank; best = path.join(dir, entry.name); }
    }
  }
  walk(repoDir, 0);
  return best ? path.relative(repoDir, best) : null;
}

function readTrunc(file, max = 3000) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return text.length > max ? text.slice(0, max) : text;
  } catch {
    return null;
  }
}

async function describeApp(repoDir, name) {
  const { url, apiKey, model } = guard.lmConfig();
  if (!url) throw new Error('No local AI configured — connect one in MY AI first.');

  const logo = findLogo(repoDir);
  let pkgDescription = null;
  try { pkgDescription = JSON.parse(fs.readFileSync(path.join(repoDir, 'package.json'), 'utf8')).description || null; } catch { /* no package.json */ }
  const readme = readTrunc(path.join(repoDir, 'README.md'));

  const prompt = `Write one short, plain sentence (max 16 words) describing what this self-hosted app does, for a home dashboard card. No marketing language, no fluff — just the function. Respond with only the sentence.

App name: ${name}
package.json description: ${pkgDescription || '(none)'}
README excerpt:
${readme || '(none)'}`;

  const res = await fetch(`${url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(apiKey && { Authorization: `Bearer ${apiKey}` }) },
    body: JSON.stringify({ model: model || undefined, messages: [{ role: 'user', content: prompt }], temperature: 0.3 }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`local AI returned HTTP ${res.status}`);
  const data = await res.json();
  const description = (data.choices?.[0]?.message?.content || '')
    .trim().replace(/^["']|["']$/g, '').split('\n')[0].slice(0, 200) || null;

  return { logo, description };
}

module.exports = { describeApp, findLogo };
