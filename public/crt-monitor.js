// CRT monitor (shared by the dashboard deploy and Workbench loads): a CRT pop-up showing the same events the bars get. Each step's label becomes a title
// card, the log scrolls under it, and the overlay collapses like a CRT when the deploy lands. "Run in
// background", Esc or a click outside hides it; the inline bars carry on either way.
// With `container`, the monitor sits inside that element (absolutely filling it) instead of over the page.
function crtMonitor({ activeId = () => null, container = null, hideLabel = 'run in background ›' } = {}) {
  let el, title, ticks, log, kicker, ghost, btn, ids = [], hidden = false;
  function build() {
    el = document.createElement('div');
    if (container) el.className = 'cine-inline'; else el.id = 'cine';
    el.setAttribute('role', 'status');
    el.innerHTML = '<div class="cine-screen"><div class="cine-ghost" aria-hidden="true"></div><div class="cine-roll" aria-hidden="true"></div><div class="cine-inner"><div class="cine-kicker"><span>Step <b data-n></b> / <b data-t></b></span><span class="cine-app"></span></div><h3 class="cine-title"></h3><div class="cine-ticks"></div><div class="cine-log" aria-hidden="true"></div><button class="cine-hide" type="button"></button></div></div>';
    [title, ticks, log, kicker, ghost, btn] = ['.cine-title', '.cine-ticks', '.cine-log', '.cine-kicker', '.cine-ghost', '.cine-hide'].map((s) => el.querySelector(s));
    btn.addEventListener('click', close);
    el.addEventListener('click', (e) => { if (e.target === el) close(); });
    (container || document.body).appendChild(el);
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
  let closeTimer;
  function close() {
    if (!el || el.hidden) return;
    hidden = true;
    el.classList.remove('in'); el.classList.add('out');
    closeTimer = setTimeout(() => { el.hidden = true; el.classList.remove('out'); }, 500);
  }
  addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  return {
    close,
    open(firstLabel = 'Reading your app', firstId = 'read') {
      if (!el) build();
      clearTimeout(closeTimer); // reopened while the last close was still animating
      ids = [firstId]; states.clear(); hidden = false;
      log.innerHTML = ''; kicker.querySelector('.cine-app').textContent = '';
      btn.textContent = hideLabel;
      el.hidden = false; el.classList.remove('out'); el.classList.add('in');
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

// Chunky dithered ripple ring — same Bayer-dot bitmap technique as reverb's
// CrtBackdrop / shelf-cmd's RippleField, ported to plain canvas. Shared by the
// dashboard (cards, grid loading) and Workbench (frame loading). Mounted on a card for the duration of a redeploy/stop/
// etc. call; `colorRgb` is an "r,g,b" string so it can borrow --ok/--warn/
// --danger directly. Returns a stop() that must be called before the card
// is torn down, or the rAF loop and ResizeObserver just keep running.
const RIPPLE_BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
function mountRippleField(container, colorRgb, opts = {}) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
  container.prepend(canvas);
  const crt = document.createElement('div');
  crt.className = 'ripple-crt';
  canvas.after(crt);
  const ctx = canvas.getContext('2d');
  const ripples = [];
  let W = 0, H = 0, raf;

  function push() {
    if (!W || !H) return;
    ripples.push({ t0: performance.now(), x: W / 2, y: H / 2 });
  }
  function size() {
    W = container.clientWidth; H = container.clientHeight;
    canvas.width = W; canvas.height = H;
  }
  size();
  const ro = new ResizeObserver(size);
  ro.observe(container);
  push();
  const amb = setInterval(push, 2800);

  function draw(now) {
    ctx.clearRect(0, 0, W, H);
    const S = opts.scale || W / 390; // dot, band and speed all scale with this (default: the card's width)
    const step = Math.max(3, Math.round(6 * S));
    const dot = Math.max(2, Math.round(4 * S));
    for (let i = ripples.length - 1; i >= 0; i--) {
      if (now - ripples[i].t0 > 4200) ripples.splice(i, 1);
    }
    ctx.fillStyle = `rgb(${colorRgb})`;
    for (let y = 2; y < H; y += step) {
      for (let x = 2; x < W; x += step) {
        let v = 0;
        for (const r of ripples) {
          const t = (now - r.t0) / 1000;
          const R = t * (opts.speed || 60) * S;
          const d = Math.hypot(x - r.x, y - r.y);
          const g = Math.exp(-Math.pow((d - R) / (22 * S), 2));
          v += g * Math.exp(-t * 0.5);
        }
        const bx = ((x / step) | 0) & 3, by = ((y / step) | 0) & 3;
        const thr = RIPPLE_BAYER[by * 4 + bx] / 16;
        if (v <= thr * 1.1 + 0.05) continue;
        ctx.globalAlpha = Math.min(0.5, v);
        ctx.fillRect(x, y, dot, dot);
      }
    }
    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);

  return () => { cancelAnimationFrame(raf); clearInterval(amb); ro.disconnect(); canvas.remove(); crt.remove(); };
}
const RIPPLE_COLOR = { ok: '63,179,127', warn: '224,165,63', danger: '224,86,79' };
