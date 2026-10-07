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
    diff: (from, to) => Math.round((parse(to) - parse(from)) / 864e5), // = daysBetween
    // Times are 'HH:MM'. An end before the start means the next day (22:30 -> 06:30 is 8 hours).
    hoursBetween: (start, end) => {
      const mins = (t) => { const [h, m] = String(t).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
      let d = mins(end) - mins(start);
      if (d < 0) d += 1440;
      return Math.round((d / 60) * 100) / 100;
    },
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
    if (!labels.length || !values.length || values.every((v) => !v)) { this.box.innerHTML = '<div class="empty" style="padding:16px 0">Nothing to chart yet.</div>'; return; }
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

// A <canvas> the page set up but never drew on (no chart, nothing painted) shows as an empty box.
// Shortly after load, such a canvas gives way to a quiet empty state.
document.addEventListener('DOMContentLoaded', () => setTimeout(() => {
  for (const c of document.querySelectorAll('canvas')) {
    if (c._forgeChart || c.style.display === 'none' || !c.width || !c.height) continue;
    let blank = true;
    try { blank = !c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((v) => v); } catch { blank = false; }
    if (!blank) continue;
    const note = Object.assign(document.createElement('div'), { className: 'empty', textContent: 'Nothing to chart yet.' });
    note.style.padding = '16px 0';
    c.style.display = 'none';
    c.after(note);
  }
}, 1800));

// One-line replacements for prompt() and confirm(): the same shape models already write, shown as an
// in-page sheet in the design system instead of the browser's pop-up.
//   const name = await ask('Rename task', task.name);   // new text, or null if cancelled
//   if (await confirmBox('Reset all stars?')) { ... }   // true / false
(() => {
  function sheet(question, value, withField) {
    return new Promise((resolve) => {
      const back = document.createElement('div');
      back.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.35);display:flex;align-items:flex-end;justify-content:center;padding:16px;padding-bottom:max(16px,env(safe-area-inset-bottom))';
      back.innerHTML = `<form class="card" style="width:100%;max-width:520px;margin:0;display:flex;flex-direction:column;gap:14px">
        <span class="label"></span>${withField ? '<input>' : ''}
        <div class="btn-row"><button type="button" class="btn" data-x>Cancel</button><button class="btn btn-primary center" style="min-height:48px">${withField ? 'Save' : 'Yes'}</button></div></form>`;
      back.querySelector('.label').textContent = question || '';
      const field = back.querySelector('input');
      if (field) field.value = value == null ? '' : String(value);
      const done = (v) => { back.remove(); resolve(v); };
      back.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); done(field ? field.value.trim() : true); });
      back.querySelector('[data-x]').addEventListener('click', () => done(field ? null : false));
      back.addEventListener('click', (e) => { if (e.target === back) done(field ? null : false); });
      document.body.appendChild(back);
      (field || back.querySelector('.btn-primary')).focus();
    });
  }
  window.ask = (question, value) => sheet(question, value, true);
  window.confirmBox = (question) => sheet(question, null, false);
})();

// Photos and documents. files.add(file) saves one and returns { id, url, name, type, size }: keep that
// object in your saved data and use its url for <img src> or <a href>. Big photos are shrunk first
// (longest side 1600px), so they load fast on a phone. files.pick('image/*') opens the picker itself.
(() => {
  async function shrink(file) {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * scale), height: Math.round(img.height * scale) });
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('shrink failed'))), 'image/jpeg', 0.85));
  }
  window.files = {
    async add(file) {
      if (!file) return null;
      let body = file, type = file.type || 'application/octet-stream', name = file.name || 'file';
      if (/^image\/(jpeg|png|webp|heic)$/.test(type) && file.size > 400e3) {
        try { body = await shrink(file); type = 'image/jpeg'; name = name.replace(/\.\w+$/, '') + '.jpg'; } catch { /* keep the original */ }
      }
      const r = await fetch('/api/files?name=' + encodeURIComponent(name), { method: 'POST', headers: { 'Content-Type': type }, body });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Could not save the file.');
      return data;
    },
    async remove(file) {
      const id = typeof file === 'string' ? file : file && file.id;
      if (id) await fetch('/api/files/' + id, { method: 'DELETE' }).catch(() => {});
    },
    // The right markup for whatever was saved: a photo for an image, a tappable link for a document,
    // '' for nothing. size: 'photo' (large), 'thumb' (in a row) or 'gallery'.
    view(file, size = 'photo') {
      if (!file || !file.url) return '';
      const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      if (/^image\//.test(file.type || '') || /\.(png|jpe?g|webp|gif|heic)$/i.test(file.name || '')) return `<img class="${size === 'thumb' ? 'thumb' : 'photo'}" src="${esc(file.url)}" alt="${esc(file.name || '')}">`;
      return size === 'thumb' ? `<a class="tile" href="${esc(file.url)}" target="_blank" rel="noopener" title="${esc(file.name || 'Document')}">DOC</a>` : `<a class="doc" href="${esc(file.url)}" target="_blank" rel="noopener">${esc(file.name || 'Document')}</a>`;
    },
    pick(accept = 'image/*') {
      return new Promise((resolve) => {
        const input = Object.assign(document.createElement('input'), { type: 'file', accept });
        input.addEventListener('change', () => resolve(input.files[0] || null));
        input.click();
      });
    },
  };
})();

// Pages in one app: <section data-page="home">, <section data-page="detail">. Links href="#/detail/42"
// (or data-go="detail" data-param="42", or pages.go('detail', 42)) switch pages; the page shown follows
// the address, so the phone's Back button works. Before a page shows, a 'pagechange' event fires on
// window with e.detail = { name, param }: fill the page there. pages.current() gives the same.
(() => {
  const read = () => {
    const parts = (location.hash || '').replace(/^#\/?/, '').split('/');
    const els = [...document.querySelectorAll('[data-page]')];
    const name = els.some((p) => p.dataset.page === parts[0]) ? parts[0] : (els[0] && els[0].dataset.page);
    return { name, param: parts.length > 1 && parts[1] !== '' ? decodeURIComponent(parts.slice(1).join('/')) : null };
  };
  const show = () => {
    if (window.Forge && Forge.mount) Forge.mount();
    const els = document.querySelectorAll('[data-page]');
    if (!els.length) return;
    const cur = read();
    window.dispatchEvent(new CustomEvent('pagechange', { detail: cur }));
    els.forEach((p) => { p.hidden = p.dataset.page !== cur.name; });
    document.querySelectorAll('a[href^="#/"], [data-go]').forEach((a) => {
      const target = a.dataset.go || (a.getAttribute('href') || '').replace(/^#\/?/, '').split('/')[0];
      a.classList.toggle('on', target === cur.name);
    });
    window.scrollTo(0, 0);
  };
  window.pages = {
    go(name, param) { location.hash = '#/' + name + (param != null ? '/' + encodeURIComponent(param) : ''); },
    back() { history.length > 1 ? history.back() : pages.go(''); },
    current: read,
    refresh: show,
  };
  addEventListener('hashchange', show);
  document.addEventListener('DOMContentLoaded', show);
  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) { e.preventDefault(); pages.go(go.dataset.go, go.dataset.param); }
  });
})();

// Forge.app: the structure for bigger apps. One state object (loaded on start, saved after every
// action), one function per page (called before it shows and after every action), one function per
// button (data-action="name") and per form (data-form="name"). Adding a feature means adding entries
// here, never rewiring the app, so an app can grow step by step without breaking what it has.
//   Forge.app({
//     key: 'gains', state: { programs: [] },
//     pages: { home(state, param) { ...fill the page... } },
//     actions: { start(state, el) { ... } },          // return false to skip the save and re-render
//     forms: { addProgram(state, data, form) { ... } } // data = the form's fields by name
//   });
window.Forge = window.Forge || {};
Forge.app = function ({ key = 'app', state = {}, pages: views = {}, actions = {}, forms = {}, start } = {}) {
  const api = { state: JSON.parse(JSON.stringify(state)) };
  Forge._app = { api, views, actions, forms, starts: start ? [start] : [] };
  // Show the error in the page, and raise it too: swallowed, it would hide a broken app from Forge's
  // checks (and from best-of-N), which only see errors that reach the window.
  const fail = (err) => { try { (window.showError || console.error)(err); } catch { /* no status line */ } setTimeout(() => { throw err; }); };
  // A new item made without its child list (a program with no workouts: []) breaks the first push or map
  // on it, the most common small-model bug measured. Any name the app's code uses as a list starts as [].
  let lists = null, seen = -1;
  const fillLists = () => {
    const src = [...document.scripts].map((x) => x.textContent).join('\n');
    if (src.length !== seen) {
      seen = src.length;
      lists = new Set([...src.matchAll(/\.(\w+)\??\.(?:push|map|filter|forEach|reduce|find|findIndex|some|every|unshift|splice|slice|sort|includes|length)\b/g)].map((m) => m[1]));
    }
    const walk = (v) => {
      if (!v || typeof v !== 'object') return;
      if (!Array.isArray(v) && v.id != null) for (const k of lists) if (v[k] === undefined) v[k] = [];
      for (const k of Object.keys(v)) walk(v[k]);
    };
    walk(api.state);
  };
  api.save = async () => { try { await store.set(key, api.state); } catch (err) { fail(err); } };
  api.render = () => { const cur = pages.current(); const view = views[cur.name]; if (view) { try { fillLists(); view(api.state, cur.param); } catch (err) { fail(err); } } };
  addEventListener('pagechange', (e) => { const view = views[e.detail.name]; if (view) { try { fillLists(); view(api.state, e.detail.param); } catch (err) { fail(err); } } });
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !actions[el.dataset.action]) return;
    e.preventDefault();
    try { fillLists(); if ((await actions[el.dataset.action](api.state, el)) !== false) { await api.save(); api.render(); } } catch (err) { fail(err); }
  });
  document.addEventListener('submit', async (e) => {
    const form = e.target.closest('[data-form]');
    if (!form || !forms[form.dataset.form]) return;
    e.preventDefault();
    try { fillLists(); if ((await forms[form.dataset.form](api.state, Object.fromEntries(new FormData(form)), form)) !== false) { form.reset(); await api.save(); api.render(); } } catch (err) { fail(err); }
  });
  (async () => {
    // Await first: a spread written before the await would snapshot the state before modules add to it.
    try { const saved = await store.get(key, {}); api.state = { ...api.state, ...saved }; Forge._app.api = api; } catch (err) { fail(err); }
    const lost = [...document.querySelectorAll('template[data-into]')].map((t) => t.dataset.into);
    Forge.mount();
    // A control nothing answers is a dead button the model can't see; name it so a retry can wire it.
    for (const into of lost.filter((x) => document.querySelector(`template[data-into="${x}"]`))) fail(new Error(`A template has data-into="${into}" but there is no page or element called ${into}`));
    for (const el of document.querySelectorAll('[data-action]')) if (!actions[el.dataset.action]) fail(new Error(`The "${el.textContent.trim().slice(0, 30)}" button has data-action="${el.dataset.action}" but no action called ${el.dataset.action}`));
    for (const el of document.querySelectorAll('form[data-form]')) if (!forms[el.dataset.form]) fail(new Error(`A form has data-form="${el.dataset.form}" but no form handler called ${el.dataset.form}`));
    for (const fn of Forge._app.starts) { try { fn(api.state); } catch (err) { fail(err); } }
    pages.refresh();
  })();
  return api;
};

// Finding things in nested state without writing lookup helpers: every item has a unique id, so
// Forge.find(state, id) returns it wherever it is, and Forge.parent(state, id) the item holding it
// (the program a workout belongs to). Measured: hand-written finders were where models broke.
Forge.find = function (root, id) {
  const want = String(id);
  const walk = (v) => {
    if (!v || typeof v !== 'object') return null;
    if (!Array.isArray(v) && v.id != null && String(v.id) === want) return v;
    for (const k of Object.keys(v)) { const hit = walk(v[k]); if (hit) return hit; }
    return null;
  };
  return walk(root);
};
Forge.parent = function (root, id) {
  const want = String(id);
  const walk = (v, owner) => {
    if (!v || typeof v !== 'object') return null;
    if (Array.isArray(v)) { for (const x of v) { if (x && x.id != null && String(x.id) === want) return owner; const hit = walk(x, x); if (hit) return hit; } return null; }
    for (const k of Object.keys(v)) { const hit = walk(v[k], v.id != null ? v : owner); if (hit) return hit; }
    return null;
  };
  return walk(root, null);
};

// Forge.extend: grow a Forge.app app by adding a module instead of rewriting it. A module brings
//   <template data-into="app">…</template>      new <section data-page> pages, into main.app
//   <template data-into="PAGE">…</template>     elements added to the end of an existing page
//   <template data-into="tabbar">…</template>   more tab links (data-into="body" adds a whole new bar)
//   a script tag calling Forge.extend({ state, pages, actions, forms, start })
// New state keys get their defaults (saved data wins), a page function for an existing page runs
// after the existing one, actions and forms are added. Measured reason (gains ladder): small models
// broke a growing app when they had to rewrite all of it for each new feature.
Forge.extend = function ({ state = {}, pages: views = {}, actions = {}, forms = {}, start } = {}) {
  const a = Forge._app;
  if (!a) throw new Error('Forge.extend needs Forge.app first');
  for (const [k, v] of Object.entries(state)) if (!(k in a.api.state)) a.api.state[k] = JSON.parse(JSON.stringify(v));
  for (const [name, fn] of Object.entries(views)) {
    const before = a.views[name];
    a.views[name] = before ? (s, param) => { before(s, param); fn(s, param); } : fn;
  }
  // An action or form a module defines again runs after the existing one ("after a set is completed,
  // start the rest timer"); either returning false skips the save and redraw.
  const compose = (table, extra) => {
    for (const [name, fn] of Object.entries(extra)) {
      const before = table[name];
      table[name] = before ? async (s, ...rest) => { const r1 = await before(s, ...rest); const r2 = await fn(s, ...rest); return r1 === false || r2 === false ? false : undefined; } : fn;
    }
  };
  compose(a.actions, actions);
  compose(a.forms, forms);
  if (start) a.starts.push(start);
};
Forge.mount = function () {
  for (const t of [...document.querySelectorAll('template[data-into]')]) {
    const into = t.dataset.into;
    const target = into === 'app' ? document.querySelector('main.app, main') : into === 'tabbar' ? document.querySelector('nav.tabbar') : into === 'body' ? document.body : document.querySelector(`[data-page="${into}"]`) || document.getElementById(into);
    if (!target) continue;
    const frag = t.content.cloneNode(true);
    for (const sec of frag.querySelectorAll('section[data-page]')) sec.hidden = true;
    target.appendChild(frag);
    t.remove();
  }
};

// $(id) is the shorthand the structured example uses; models copy it without defining it. A page's
// own const $ still wins.
if (!window.$) window.$ = (id) => document.getElementById(id);
