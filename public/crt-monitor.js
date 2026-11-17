// CRT monitor (shared by the dashboard deploy and Workbench loads): a CRT pop-up showing the same events the bars get. Each step's label becomes a title
// card, the log scrolls under it, and the overlay collapses like a CRT when the deploy lands. "Run in
// background", Esc or a click outside hides it; the inline bars carry on either way.
function crtMonitor({ activeId = () => null } = {}) {
  let el, title, ticks, log, kicker, ghost, btn, ids = [], hidden = false;
  function build() {
    el = document.createElement('div');
    el.id = 'cine';
    el.setAttribute('role', 'status');
    el.innerHTML = '<div class="cine-screen"><div class="cine-ghost" aria-hidden="true"></div><div class="cine-roll" aria-hidden="true"></div><div class="cine-inner"><div class="cine-kicker"><span>Step <b data-n></b> / <b data-t></b></span><span class="cine-app"></span></div><h3 class="cine-title"></h3><div class="cine-ticks"></div><div class="cine-log" aria-hidden="true"></div><button class="cine-hide" type="button">run in background ›</button></div></div>';
    [title, ticks, log, kicker, ghost, btn] = ['.cine-title', '.cine-ticks', '.cine-log', '.cine-kicker', '.cine-ghost', '.cine-hide'].map((s) => el.querySelector(s));
    btn.addEventListener('click', close);
    el.addEventListener('click', (e) => { if (e.target === el) close(); });
    document.body.appendChild(el);
  }
  // Typed out a character at a time behind a block cursor, like a terminal; a new title cancels the old one.
  let typeTimer;
  const instant = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function setTitle(text, tone = '') {
    clearTimeout(typeTimer);
    title.className = 'cine-title ' + tone;
    title.innerHTML = '<span class="prompt">&gt; </span><span class="typed"></span><span class="cursor"></span>';
    const typed = title.querySelector('.typed');
    let i = instant ? text.length - 1 : 0;
    (function typeChar() {
      typed.textContent = text.slice(0, ++i);
      if (i < text.length) typeTimer = setTimeout(typeChar, 30 + Math.random() * 45);
    })();
  }
  function renderTicks(states) {
    ticks.innerHTML = ids.map((id) => `<span class="cine-tick ${states.get(id) || ''}"></span>`).join('');
    const n = Math.max(1, ids.indexOf(activeId()) + 1);
    kicker.querySelector('[data-n]').textContent = n;
    kicker.querySelector('[data-t]').textContent = ids.length;
    ghost.textContent = String(n).padStart(2, '0');
  }
  const states = new Map();
  function close() {
    if (!el || el.hidden) return;
    hidden = true;
    el.className = 'out';
    setTimeout(() => { el.hidden = true; el.className = ''; }, 500);
  }
  addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  return {
    open(firstLabel = 'Reading your app', firstId = 'read') {
      if (!el) build();
      ids = [firstId]; states.clear(); hidden = false;
      log.innerHTML = ''; kicker.querySelector('.cine-app').textContent = '';
      btn.textContent = 'run in background ›';
      el.hidden = false; el.className = 'in';
      setTitle(firstLabel);
      renderTicks(states);
    },
    plan(steps) { ids = [ids[0], ...steps.map((s) => s.id)]; renderTicks(states); },
    step(id, ev, label) {
      if (!el || hidden) return;
      if (ev.state) states.set(id, ev.state);
      if (ev.state === 'active') setTitle(label);
      renderTicks(states);
    },
    line(msg, bad) {
      if (!el || hidden) return;
      const d = document.createElement('div');
      d.textContent = msg;
      if (bad) d.className = 'bad';
      log.appendChild(d);
      while (log.children.length > 40) log.firstChild.remove();
    },
    async done(name) {
      if (!el || hidden) return;
      ids.forEach((id) => states.set(id, 'done'));
      renderTicks(states);
      kicker.querySelector('.cine-app').textContent = name;
      setTitle('Live.', 'ok');
      await new Promise((ok) => setTimeout(ok, 1100));
      close();
      await new Promise((ok) => setTimeout(ok, 500));
    },
    fail(msg) {
      if (!el || hidden) return;
      if (activeId()) states.set(activeId(), 'failed');
      renderTicks(states);
      setTitle('It stopped here.', 'bad');
      this.line(msg, true);
      btn.textContent = 'close ×';
    },
  };
}
