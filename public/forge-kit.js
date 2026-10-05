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
// Days are 'YYYY-MM-DD' strings in local time (toISOString is UTC, which makes "today" yesterday
// for half the day east of Greenwich).
window.dates = (() => {
  const pad = (n) => String(n).padStart(2, '0');
  const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (k) => { const [y, m, d] = String(k).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
  return {
    today: () => key(new Date()),
    addDays: (day, n) => { const d = parse(day); d.setDate(d.getDate() + n); return key(d); },
    daysBetween: (from, to) => Math.round((parse(to) - parse(from)) / 864e5),
    weekStart: (day = key(new Date())) => { const d = parse(day); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return key(d); },
    monthOf: (day = key(new Date())) => String(day).slice(0, 7),
    label: (day) => parse(day).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
  };
})();
