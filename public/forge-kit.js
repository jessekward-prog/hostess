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
    parse, // models reach for it; returns a local Date
    // More names models reach for. All take and return 'YYYY-MM-DD' strings unless named otherwise.
    monthStart: (day = key(new Date())) => `${String(day).slice(0, 7)}-01`,
    monthEnd: (day = key(new Date())) => { const d = parse(day); return key(new Date(d.getFullYear(), d.getMonth() + 1, 0)); },
    weekEnd: (day = key(new Date())) => { const d = parse(day); d.setDate(d.getDate() + (7 - d.getDay()) % 7); return key(d); },
    isToday: (day) => day === key(new Date()),
    dayName: (day) => parse(day).toLocaleDateString(undefined, { weekday: 'long' }),
  };
})();

// Whatever accent the page picks stays readable: dark text on a pale accent button, and a deeper
// (or, on dark pages, lighter) "ink" shade wherever the accent is used as text.
document.addEventListener('DOMContentLoaded', () => {
  const root = document.documentElement;
  const probe = document.createElement('i');
  document.body.appendChild(probe);
  const rgbOf = (value) => { probe.style.color = ''; probe.style.color = value; return (getComputedStyle(probe).color.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number); };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  // Read through <body>: pages put data-theme on <html> or on <body>, and the ink must read on
  // both the page background and the cards.
  const css = getComputedStyle(document.body);
  const accent = rgbOf(css.getPropertyValue('--accent').trim() || '#2f6fed');
  const grounds = [rgbOf(css.getPropertyValue('--bg').trim() || '#fff'), rgbOf(css.getPropertyValue('--surface').trim() || '#fff')];
  probe.remove();
  if (ratio(accent, [255, 255, 255]) < 3) document.body.style.setProperty('--accent-text', '#111111');
  const dark = lum(grounds[0]) < 0.2;
  let ink = accent.slice();
  for (let i = 0; i < 24 && Math.min(...grounds.map((g) => ratio(ink, g))) < 4.6; i++) ink = ink.map((v) => Math.round(dark ? v + (255 - v) * 0.15 : v * 0.85));
  document.body.style.setProperty('--accent-ink', `rgb(${ink.join(',')})`);
});

// A "Loading…" line still showing after the data has loaded is always a bug (the page forgot to
// replace it), so once the first store.get has answered, any element that still says only that goes.
(() => {
  const realGet = window.store.get;
  let cleared = false;
  window.store.get = async (...args) => {
    try { return await realGet(...args); }
    finally {
      if (!cleared) {
        cleared = true;
        setTimeout(() => {
          for (const el of document.querySelectorAll('body *')) {
            if (!el.children.length && /^\s*loading(\.\.\.|…)?\s*$/i.test(el.textContent)) el.textContent = '';
          }
        }, 1200);
      }
    }
  };
})();

// Names models reach for without the dates. prefix, and the showError the worked example defines.
// A page's own definitions of any of these win.
Object.assign(window, { addDays: dates.addDays, daysBetween: dates.daysBetween, weekStart: dates.weekStart, monthOf: dates.monthOf });
window.showError = (err) => {
  const msg = (err && err.message) || String(err);
  const status = document.querySelector('.status');
  if (status) { status.className = 'status error'; status.textContent = msg; return; }
  let toast = document.getElementById('forge-error');
  if (!toast) {
    toast = Object.assign(document.createElement('div'), { id: 'forge-error', className: 'status error' });
    Object.assign(toast.style, { position: 'fixed', left: '16px', right: '16px', bottom: 'max(16px, env(safe-area-inset-bottom))', padding: '12px 16px', borderRadius: '14px', background: 'var(--surface)', boxShadow: '0 6px 24px rgba(0,0,0,.15)', zIndex: 9999 });
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
};
// Models also use a bare `today` as a value (s.day === today): a live getter for the day string.
Object.defineProperty(window, 'today', {
  get: () => dates.today(),
  set: (v) => Object.defineProperty(window, 'today', { value: v, writable: true, configurable: true }), // `var today = x` keeps x
  configurable: true,
});

// <input type="number" min="0.01"> without a step only accepts 0.01, 1.01, 2.01…, so "25" is rejected
// with a confusing browser message. Pages mean "any amount": say so. Also for inputs added later.
(() => {
  const fixStep = (root) => root.querySelectorAll && root.querySelectorAll('input[type=number]:not([step])').forEach((el) => {
    if (/\./.test(el.getAttribute('min') || '')) el.setAttribute('step', 'any');
  });
  document.addEventListener('DOMContentLoaded', () => {
    fixStep(document);
    new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.nodeType === 1 && (fixStep(n), n.matches && n.matches('input[type=number]:not([step])') && fixStep(n.parentNode))))).observe(document.body, { childList: true, subtree: true });
  });
})();

// Models asked for a chart reach for Chart.js, which isn't loaded. This covers the part they use:
// new Chart(canvasOrCtx, { type: 'bar' | 'line', data: { labels, datasets: [{ data, label }] } }),
// chart.data / chart.update() / chart.destroy(), drawn as a themed SVG in place of the canvas.
window.Chart = class {
  constructor(target, config = {}) {
    const canvas = target && target.canvas ? target.canvas : (typeof target === 'string' ? document.getElementById(target) : target);
    this.type = config.type || 'bar';
    this.data = config.data || { labels: [], datasets: [] };
    this.options = config.options || {};
    // The canvas stays in the page (hidden) so code that looks it up again keeps working; one chart
    // per canvas, so a page that makes a new Chart on every render doesn't stack copies.
    if (canvas && canvas._forgeChart) { this.box = canvas._forgeChart.box; }
    else {
      this.box = document.createElement('div');
      this.box.className = 'forge-chart';
      this.box.style.cssText = 'width:100%;margin:8px 0';
      if (canvas && canvas.parentNode) { canvas.style.display = 'none'; canvas.after(this.box); }
    }
    if (canvas) canvas._forgeChart = this;
    this.update();
  }
  update() {
    const labels = (this.data.labels || []).map(String);
    const sets = (this.data.datasets || []).filter((d) => d && Array.isArray(d.data));
    const values = sets.flatMap((d) => d.data.map((v) => Number((v && typeof v === 'object') ? v.y : v) || 0));
    if (!labels.length || !values.length) { this.box.innerHTML = '<div class="empty" style="padding:16px 0">Nothing to chart yet.</div>'; return; }
    const W = 340, H = 180, top = 14, bottom = 26, left = 8, right = 8;
    const max = Math.max(1, ...values), n = labels.length, slot = (W - left - right) / n;
    const y = (v) => top + (H - top - bottom) * (1 - v / max);
    let marks = '';
    sets.forEach((set, si) => {
      const vals = set.data.map((v) => Number((v && typeof v === 'object') ? v.y : v) || 0);
      const op = sets.length > 1 ? 1 - si * 0.35 : 1;
      if (this.type === 'line') {
        const pts = vals.map((v, i) => `${left + slot * (i + 0.5)},${y(v)}`).join(' ');
        marks += `<polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-opacity="${op}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
        marks += vals.map((v, i) => `<circle cx="${left + slot * (i + 0.5)}" cy="${y(v)}" r="3.5" fill="var(--accent)" fill-opacity="${op}"/>`).join('');
      } else {
        const bw = Math.max(4, (slot * 0.62) / sets.length);
        marks += vals.map((v, i) => `<rect x="${left + slot * i + (slot - bw * sets.length) / 2 + bw * si}" y="${y(v)}" width="${bw}" height="${Math.max(0, H - bottom - y(v))}" rx="${Math.min(6, bw / 3)}" fill="var(--accent)" fill-opacity="${op}"><title>${labels[i]}: ${v}</title></rect>`).join('');
      }
    });
    const ticks = labels.map((l, i) => `<text x="${left + slot * (i + 0.5)}" y="${H - 8}" text-anchor="middle" font-size="10" font-family="var(--mono)" fill="var(--muted)">${l.length > 6 ? l.slice(0, 5) + '…' : l}</text>`).join('');
    const maxLabel = `<text x="${W - right}" y="${top - 2}" text-anchor="end" font-size="10" font-family="var(--mono)" fill="var(--muted)">${Math.round(max * 10) / 10}</text>`;
    this.box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="chart"><line x1="${left}" x2="${W - right}" y1="${H - bottom}" y2="${H - bottom}" stroke="var(--line)"/>${marks}${ticks}${maxLabel}</svg>`;
  }
  destroy() { this.box.innerHTML = ''; }
};
