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
    return {
      linked: true,
      url: data.url || '',
      model: data.selected || data.model || '',
      apiKeySet: !!data.apiKeySet,
      models: Array.isArray(data.models) ? data.models : [],
      provider: data.provider || null,
      // The app itself reached us fine (linked: true) but may be unable to reach
      // its *own* configured endpoint (e.g. bad URL) -- surfaced separately so
      // that's not confused with a sync failure between here and the app.
      appError: data.error || null,
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
