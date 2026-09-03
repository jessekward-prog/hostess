const registry = require('./registry');

const TIMEOUT_MS = 4000;

// Apps that expose a GET/PUT /api/lm (shelf-cmd's MY AI, macro-cmd's Local AI
// panel) can be synced from here instead of only their own in-app settings —
// using SYNC_SECRET already sitting in this app's own env values as the
// credential, so nothing new needs storing. Absent that value, the app just
// isn't wired for this and the card shows nothing extra (see probe()).
function target(name) {
  const record = registry.get(name);
  const secret = record?.envValues?.SYNC_SECRET;
  if (!secret || !record.port) return null;
  return { url: `http://127.0.0.1:${record.port}/api/lm`, secret };
}

async function probe(name) {
  const t = target(name);
  if (!t) return { linked: false };
  try {
    const res = await fetch(t.url, {
      headers: { 'x-sync-secret': t.secret },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`app returned HTTP ${res.status}`);
    const data = await res.json();
    // Two distinct providers, not one flat set of fields -- matches macro-cmd's
    // /api/lm shape ({provider, local:{...}, anthropic:{...}}).
    return {
      linked: true,
      provider: data.provider || null,
      local: {
        url: data.local?.url || '',
        model: data.local?.model || '',
        apiKeySet: !!data.local?.apiKeySet,
        models: Array.isArray(data.local?.models) ? data.local.models : [],
        error: data.local?.error || null,
      },
      // Absent entirely (not just apiKeySet:false) means the app has no Claude
      // option at all -- single-provider apps like gains-cmd just omit this key
      // rather than reporting a permanently-empty one, so the UI can tell "no
      // key yet" apart from "not a thing this app does" and skip the toggle.
      anthropic: data.anthropic ? {
        apiKeySet: !!data.anthropic.apiKeySet,
        model: data.anthropic.model || '',
      } : null,
      // Which env var names this response makes live-editable -- the app says
      // so itself rather than Hostess guessing from a naming convention, so a
      // future field (a new provider, a differently-named var) never needs a
      // matching change on this side to avoid a raw-env-panel double-up.
      managedEnv: Array.isArray(data.managedEnv) ? data.managedEnv : [],
    };
  } catch (err) {
    return { linked: false, configured: true, error: err.message };
  }
}

async function update(name, values) {
  const t = target(name);
  if (!t) throw new Error('No SYNC_SECRET set for this app yet — set one in its env panel first.');
  const res = await fetch(t.url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-sync-secret': t.secret },
    body: JSON.stringify(values),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `app returned HTTP ${res.status}`);
  return body;
}

module.exports = { probe, update };
