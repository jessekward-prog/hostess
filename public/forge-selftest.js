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
    // After a reopen: is the uploaded file shown (or linked), here or one tap into a detail page?
    if (d.__forge === 'filecheck') {
      const seen = () => [...document.querySelectorAll('img')].some((i) => /\/(forge-files|api\/files)\//.test(i.src) && i.complete && i.naturalWidth > 0)
        || [...document.querySelectorAll('a[href]')].some((a) => /\/(forge-files|api\/files)\//.test(a.getAttribute('href') || ''));
      let ok = seen();
      if (!ok) { const link = [...document.querySelectorAll('a[href^="#/"], [data-go], .row')].find(visible); if (link) { link.click(); await wait(700); ok = seen(); } }
      return parent.postMessage({ __forge: 'filecheck-done', ok }, '*');
    }
    // Edit: an Edit control leads to a field holding the item's text; change it and save there.
    if (d.__forge === 'editcheck') {
      const edit = [...document.querySelectorAll('button, a')].filter(visible).find((b) => /^\s*edit\b/i.test(b.textContent));
      if (!edit) return parent.postMessage({ __forge: 'editcheck-done', ok: null }, '*');
      edit.click();
      await wait(500);
      const field = [...document.querySelectorAll('input:not([type=checkbox]):not([type=file]), textarea')].filter(visible).find((f) => (f.value || '').toLowerCase().includes(String(d.mark).toLowerCase()));
      if (!field) return parent.postMessage({ __forge: 'editcheck-done', ok: false, why: 'nofield' }, '*');
      setValue(field, 'Edited Beta');
      const form = field.closest('form');
      if (form && form.requestSubmit) form.requestSubmit();
      else { const save = [...document.querySelectorAll('button')].filter(visible).reverse().find((b) => /save|update|done|ok/i.test(b.textContent)); if (save) save.click(); }
      for (let i = 0; i < 3; i++) { await wait(350); const more = document.activeElement; if (more && more.closest && more.closest('form') && /INPUT|TEXTAREA/.test(more.tagName)) more.closest('form').requestSubmit(); else break; }
      await wait(600);
      return parent.postMessage({ __forge: 'editcheck-done', ok: true }, '*');
    }
    // Pages: links switch the visible page, and Back returns.
    if (d.__forge === 'pagecheck') {
      const pagesEls = [...document.querySelectorAll('[data-page]')];
      if (pagesEls.length < 2) return parent.postMessage({ __forge: 'pagecheck-done', ok: null }, '*');
      const shown = () => { const v = pagesEls.find((p) => !p.hidden && p.offsetParent !== null); return v ? v.dataset.page : null; };
      const start = shown();
      let switched = false;
      for (const a of [...document.querySelectorAll('a[href^="#/"], [data-go]')].filter(visible).slice(0, 6)) { a.click(); await wait(400); if (shown() !== start) { switched = true; break; } }
      let back = false;
      if (switched) { history.back(); await wait(500); back = shown() === start; }
      return parent.postMessage({ __forge: 'pagecheck-done', ok: switched && back, switched }, '*');
    }
    if (d.__forge !== 'usetest') return;
    const res = { stuckLoading: /\bloading\b/i.test(document.body.innerText), inputs: 0, buttons: 0, puts: 0, hadFile: false };
    const startPuts = puts;
    const today = window.dates ? dates.today() : new Date().toISOString().slice(0, 10);
    let timeN = 0;
    for (const el of document.querySelectorAll('input, textarea, select')) {
      if (!visible(el) || el.disabled || el.readOnly) continue;
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (el.tagName === 'SELECT') { if (el.options.length > 1) { el.selectedIndex = 1; el.dispatchEvent(new Event('change', { bubbles: true })); } }
      else if (type === 'number' || type === 'range') setValue(el, String(Math.min(el.max !== '' ? Number(el.max) : 25, Math.max(el.min !== '' ? Number(el.min) : 25, 25))));
      else if (type === 'date') setValue(el, today);
      else if (type === 'time') setValue(el, ['22:30', '06:30', '07:15'][timeN++ % 3]); // bedtime, then wake time
      else if (type === 'datetime-local') setValue(el, `${today}T22:30`);
      else if (type === 'month') setValue(el, today.slice(0, 7));
      else if (type === 'week') setValue(el, '2026-W41');
      else if (type === 'file') {
        // A real 1x1 PNG (or a tiny PDF when the field wants documents), as if picked from the phone.
        const wantsDoc = /pdf|document|\.doc/i.test(el.accept || '') && !/image/i.test(el.accept || '');
        const file = wantsDoc
          ? new File(['%PDF-1.1\n%Forge check\n'], 'check.pdf', { type: 'application/pdf' })
          : new File([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))], 'check.png', { type: 'image/png' });
        const dt = new DataTransfer();
        dt.items.add(file);
        el.files = dt.files;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        res.hadFile = true;
      }
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
