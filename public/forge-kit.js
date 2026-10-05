// Forge kit: put on every forged page ahead of the model's own code, so the model calls these
// instead of writing fetch code. A missing key returns the fallback, never null.
window.store = {
  async get(key, fallback = null) {
    const r = await fetch('/api/data/' + encodeURIComponent(key));
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not load your data.');
    const value = await r.json();
    return value === null || value === undefined ? fallback : value;
  },
  async set(key, value) {
    const r = await fetch('/api/data/' + encodeURIComponent(key), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not save.');
  },
};
window.askAI = async (prompt, system) => {
  const r = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, system }) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'The AI did not answer.');
  return data.text || '';
};
window.notify = async (title, message) => {
  const r = await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, message }) });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Could not send the notification.');
};
