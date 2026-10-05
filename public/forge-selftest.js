// Forge use-test: runs only inside the sandboxed preview. On request from the Forge page it uses
// the app like a person would (types into the form, presses the main button) and reports what
// happened: how many saves it made, and whether it was stuck on "Loading" before anyone touched it.
(() => {
  let puts = 0;
  const realFetch = window.fetch;
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (/\/api\/data\//.test(url) && String(init.method || '').toUpperCase() === 'PUT') puts++;
    return realFetch(input, init);
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => { const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden'; };
  const setValue = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
  const pageText = () => document.body.innerText + ' ' + [...document.querySelectorAll('input, textarea, select')].map((e) => e.value).join(' ');

  addEventListener('message', async (e) => {
    const d = e.data;
    if (!d) return;
    if (d.__forge === 'text') return parent.postMessage({ __forge: 'text-done', text: pageText() }, '*');
    if (d.__forge !== 'usetest') return;
    const res = { stuckLoading: /\bloading\b/i.test(document.body.innerText), inputs: 0, buttons: 0, puts: 0 };
    const startPuts = puts;
    const today = window.dates ? dates.today() : new Date().toISOString().slice(0, 10);
    let timeN = 0;
    for (const el of document.querySelectorAll('input, textarea, select')) {
      if (!visible(el) || el.disabled || el.readOnly) continue;
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (el.tagName === 'SELECT') { if (el.options.length > 1) { el.selectedIndex = 1; el.dispatchEvent(new Event('change', { bubbles: true })); } }
      else if (type === 'number' || type === 'range') setValue(el, '25');
      else if (type === 'date') setValue(el, today);
      else if (type === 'time') setValue(el, ['22:30', '06:30', '07:15'][timeN++ % 3]); // bedtime, then wake time
      else if (type === 'datetime-local') setValue(el, `${today}T22:30`);
      else if (type === 'month') setValue(el, today.slice(0, 7));
      else if (type === 'week') setValue(el, '2026-W41');
      else if (/^(text|search|email|url|tel)$/.test(type) || el.tagName === 'TEXTAREA') setValue(el, d.mark);
      else continue;
      res.inputs++;
    }
    const buttons = [...document.querySelectorAll('button, input[type=submit]')].filter(visible);
    res.buttons = buttons.length;
    const main = buttons.filter((b) => /add|save|log|create|submit|record|track|^\s*\+/i.test(`${b.textContent} ${b.value || ''} ${b.getAttribute('aria-label') || ''}`));
    for (const b of (main.length ? main : buttons.slice(0, 1)).slice(0, 3)) { b.click(); await wait(400); }
    await wait(600);
    res.puts = puts - startPuts;
    parent.postMessage({ __forge: 'usetest-done', ...res }, '*');
  });
})();
