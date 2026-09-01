const fs = require('fs');
const path = require('path');
const settings = require('./settings');

const MAX_CHARS = 6000;
const ENTRYPOINT_CANDIDATES = ['server.js', 'index.js', 'app.js', 'main.py', 'app.py', 'main.go'];

function lmConfig() {
  const url = (settings.get('lmUrl') || process.env.HOSTESS_GUARD_LM_URL || '').trim().replace(/\/+$/, '');
  const apiKey = settings.get('lmApiKey') || process.env.HOSTESS_GUARD_LM_KEY || '';
  const model = settings.get('lmModel') || process.env.HOSTESS_GUARD_LM_MODEL || '';
  return { url, apiKey, model };
}

function readTrunc(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n...(truncated)` : text;
  } catch {
    return null;
  }
}

function guessEntrypoint(repoDir) {
  return ENTRYPOINT_CANDIDATES.find((c) => fs.existsSync(path.join(repoDir, c))) || null;
}

const EMPTY_FINDINGS = { risk: 'skipped', summary: '', findings: [], scannedAt: new Date().toISOString() };

async function scanRepo(repoDir, log = () => {}) {
  const { url, apiKey, model } = lmConfig();

  if (!url) {
    log('Security guard: no local AI configured (see the MY AI panel) — skipping scan.');
    return { ...EMPTY_FINDINGS, summary: 'No local AI configured — scan skipped.', scannedAt: new Date().toISOString() };
  }

  const dockerfile = readTrunc(path.join(repoDir, 'Dockerfile'));
  const manifestRaw = readTrunc(path.join(repoDir, 'app.yaml'));
  const entry = guessEntrypoint(repoDir);
  const entrySrc = entry ? readTrunc(path.join(repoDir, entry)) : null;

  const prompt = `You are helping an ordinary, non-technical person decide whether it's safe to run this app on their own home computer, unattended, via a personal self-host tool. Review the files below (about to be built into a Docker image and run) for anything that would put THEM or THEIR HOME NETWORK at risk. Cover both:

1. Malicious or unsafe code: hardcoded secrets/credentials, commands that download-and-execute remote scripts (curl|bash etc.), destructive filesystem operations outside the app's own directory, code that exfiltrates data to unexpected remote hosts, obviously obfuscated/malicious code.
2. Home-hosting exposure: anything that tries to request elevated Docker privileges, host networking, or access to the Docker socket (a full host takeover if granted); an admin or data-writing endpoint with no authentication that would be dangerous if this port were ever exposed beyond their own machine; code that scans or reaches out to other devices on the local network; anything that silently phones home to a third party.

Do not flag routine app behavior (normal HTTP calls to expected APIs, normal env var usage, normal docker EXPOSE/CMD, a dev server with no auth that's clearly only meant for localhost use).

For each real finding, explain WHY it's dangerous in one plain sentence a non-technical home user would understand — not jargon, not a CVE id, just what could actually go wrong for them.

Respond with ONLY a JSON object: {"risk": "low"|"medium"|"high", "summary": "one sentence, plain language", "findings": [{"issue": "short label", "why": "plain-language consequence for a home user"}]}

--- Dockerfile ---
${dockerfile || '(none)'}

--- app.yaml ---
${manifestRaw || '(none)'}

--- ${entry || 'entrypoint'} ---
${entrySrc || '(not found)'}
`;

  log('Security guard: scanning with local AI...');

  let raw;
  try {
    const res = await fetch(`${url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey && { Authorization: `Bearer ${apiKey}` }) },
      body: JSON.stringify({
        model: model || undefined,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`local AI returned HTTP ${res.status}`);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '{}';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    raw = JSON.parse(jsonMatch ? jsonMatch[0] : content);
  } catch (err) {
    log(`Security guard: scan unavailable (${err.message}) — proceeding unscanned.`);
    return { risk: 'unknown', summary: 'Scan unavailable — local AI unreachable.', findings: [], scannedAt: new Date().toISOString() };
  }

  const risk = ['low', 'medium', 'high'].includes(raw.risk) ? raw.risk : 'unknown';
  const summary = typeof raw.summary === 'string' ? raw.summary : '';
  const findings = Array.isArray(raw.findings)
    ? raw.findings
        .filter((f) => f && typeof f.issue === 'string')
        .map((f) => ({ issue: f.issue, why: typeof f.why === 'string' ? f.why : '' }))
    : [];

  log(`Security guard: risk=${risk}${summary ? ` — ${summary}` : ''}`);
  return { risk, summary, findings, scannedAt: new Date().toISOString() };
}

module.exports = { scanRepo, lmConfig };
