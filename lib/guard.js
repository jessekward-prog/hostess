const fs = require('fs');
const path = require('path');

// Defaults point at "the library" — the shared LM Studio instance already used
// by shelf-cmd/gains-cmd/partscout. Override via env if you want a different model.
const LM_URL = process.env.HOSTESS_GUARD_LM_URL || 'http://100.123.10.122:1235';
const LM_KEY = process.env.HOSTESS_GUARD_LM_KEY || 'sk-lm-dSwr83ke:W7k5nbPmyIZcqvGOcHNS';
const LM_MODEL = process.env.HOSTESS_GUARD_LM_MODEL || 'google/gemma-4-e2b';

const MAX_CHARS = 6000;
const ENTRYPOINT_CANDIDATES = ['server.js', 'index.js', 'app.js', 'main.py', 'app.py', 'main.go'];

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

async function scanRepo(repoDir, log = () => {}) {
  const dockerfile = readTrunc(path.join(repoDir, 'Dockerfile'));
  const manifestRaw = readTrunc(path.join(repoDir, 'app.yaml'));
  const entry = guessEntrypoint(repoDir);
  const entrySrc = entry ? readTrunc(path.join(repoDir, entry)) : null;

  const prompt = `You are a security reviewer gating an automatic deploy pipeline. Review the files below from a repo about to be built into a Docker image and run unattended. Flag only real security concerns: hardcoded secrets/credentials, commands that download-and-execute remote scripts (curl|bash etc.), privilege escalation, destructive filesystem operations outside the app's own directory, code that exfiltrates data to unexpected remote hosts, or obviously obfuscated/malicious code. Do not flag routine app behavior (normal HTTP calls, normal env var usage, normal docker EXPOSE/CMD).

Respond with ONLY a JSON object: {"risk": "low"|"medium"|"high", "summary": "one sentence", "findings": ["short bullet", ...]}

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
    const res = await fetch(`${LM_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LM_KEY}` },
      body: JSON.stringify({
        model: LM_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) throw new Error(`LM Studio HTTP ${res.status}`);
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
  const findings = Array.isArray(raw.findings) ? raw.findings.filter((f) => typeof f === 'string') : [];

  log(`Security guard: risk=${risk}${summary ? ` — ${summary}` : ''}`);
  return { risk, summary, findings, scannedAt: new Date().toISOString() };
}

module.exports = { scanRepo };
