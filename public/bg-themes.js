// Shared by the dashboard sidebar (index.html) and the Workbench backdrop (workbench.html).
// Sidebar background themes. Each draws onto a canvas that is PX times smaller than the sidebar and
// scaled up with pixelated sampling, so everything reads as a bitmap. Picked in the THEME panel.
// ASCII themes share one grid renderer. glyph(c, r, o) returns '' or a char, or [char, alpha];
// step(o) runs once per redraw for stateful ones (rain, life). o = {cols, rows, t, f, state}.
function asciiTheme(label, every, glyph, step) {
  return { label, group: 'ASCII', px: 1, every, draw({ ctx, W, H, f, state }) {
    const cols = Math.ceil(W / 8), rows = Math.ceil(H / 12), o = { cols, rows, t: f * 0.01, f, state };
    if (step) step(o);
    ctx.font = '11px "JetBrains Mono", monospace'; ctx.textBaseline = 'top';
    let last = null;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      let g = glyph(c, r, o); if (!g) continue;
      const [ch, a] = Array.isArray(g) ? g : [g, 0.2];
      if (!ch || ch === ' ') continue;
      if (a !== last) { ctx.fillStyle = `rgba(176,176,176,${a})`; last = a; }
      ctx.fillText(ch, c * 8, r * 12);
    }
  } };
}

// Scope themes share one poller (/api/stats every 2s) and a rolling CPU/MEM history; each variant only draws.
function scopeTheme(label, render) {
  return { label, group: 'SCOPE', px: 2,
    init({ state }) {
      state.cpu = []; state.mem = [];
      const poll = async () => { try { const r = await fetch('/api/stats'); if (r.ok) state.last = await r.json(); } catch {} };
      poll();
      const id = setInterval(poll, 2000);
      return () => clearInterval(id);
    },
    draw(o) {
      const { ctx, W, H, f, state } = o;
      if (f % 20 === 0 && state.last) { // one new sample column every ~1/3 s
        state.cpu.push(state.last.cpu); state.mem.push(state.last.mem);
        if (state.cpu.length > W) { state.cpu.shift(); state.mem.shift(); }
      }
      ctx.fillStyle = 'rgba(255,255,255,0.06)'; // graticule
      for (const gy of [0.45, 0.55, 0.65, 0.75]) for (let x = 0; x < W; x += 4) ctx.fillRect(x, Math.round(H * gy), 1, 1);
      const trace = (arr, top, h, color) => {
        ctx.fillStyle = color;
        let prev = null;
        arr.forEach((v, i) => {
          const x = W - arr.length + i, y = Math.round(top + h * (1 - v));
          const a = prev === null ? y : Math.min(prev, y), b = prev === null ? y : Math.max(prev, y);
          ctx.fillRect(x, a, 1, b - a + 1); prev = y;
        });
      };
      render({ ...o, trace });
    } };
}

const BG_THEMES = {
  waves: { label: 'Waves', px: 2, draw({ ctx, W, H, f, PX }) {
    const t = f * 0.0002;
    const bands = [
      { amp: 40, len: 0.9, sp: 0.18, y: 0.5, a: 0.06, color: '176,176,176' },
      { amp: 65, len: 0.6, sp: 0.12, y: 0.6, a: 0.05, color: '102,102,102' },
      { amp: 85, len: 0.4, sp: 0.08, y: 0.7, a: 0.035, color: '68,68,68' },
    ];
    bands.forEach((b) => {
      ctx.fillStyle = `rgba(${b.color},${b.a * 2.5})`;
      let prev = null;
      for (let x = 0; x < W; x++) {
        const p = x / W;
        const y = Math.round(H * b.y + Math.sin(p * 6.28 * b.len + t / b.sp) * (b.amp / PX) + Math.sin(p * 15.7 * b.len - (t / b.sp) * 1.7) * (b.amp / PX) * 0.3);
        const from = prev === null ? y : Math.min(prev, y), to = prev === null ? y : Math.max(prev, y);
        ctx.fillRect(x, from, 1, to - from + 1);
        prev = y;
      }
    });
  } },

  fog: { label: 'Fog', px: 4,
    draw({ ctx, W, H, f, state }) {
      if (!state.img || state.img.width !== W || state.img.height !== H) state.img = ctx.createImageData(W, H);
      const BAYER = [[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]];
      const px = new Uint32Array(state.img.data.buffer);
      const t = f * 0.004;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const v = (Math.sin(x * 0.09 + t * 1.3) + Math.sin(y * 0.07 - t) + Math.sin((x + y) * 0.05 + t * 0.7) + Math.sin(Math.hypot(x, y) * 0.06 - t)) / 8 + 0.5; // 0..1
        px[y * W + x] = v * 0.32 > BAYER[y & 3][x & 3] / 16 ? 0x0fffffff : 0;
      }
      ctx.putImageData(state.img, 0, 0);
    } },

  scope: scopeTheme('Scope', ({ ctx, W, H, A, state, trace }) => {
    trace(state.mem, H * 0.45, H * 0.2, 'rgba(176,176,176,0.14)');
    trace(state.cpu, H * 0.45, H * 0.2, `rgba(${A[0]},${A[1]},${A[2]},0.32)`);
  }),
  area: scopeTheme('Area', ({ ctx, W, H, A, state, trace }) => {
    const top = H * 0.45, h = H * 0.22;
    ctx.fillStyle = `rgba(${A[0]},${A[1]},${A[2]},0.1)`;
    state.cpu.forEach((v, i) => { const x = W - state.cpu.length + i, y = Math.round(top + h * (1 - v)); for (let yy = y + 1; yy < top + h; yy++) if ((x + yy) & 1) ctx.fillRect(x, yy, 1, 1); });
    trace(state.cpu, top, h, `rgba(${A[0]},${A[1]},${A[2]},0.34)`);
    ctx.fillStyle = 'rgba(176,176,176,0.16)';
    state.mem.forEach((v, i) => { if (i % 3 === 0) ctx.fillRect(W - state.mem.length + i, Math.round(top + h * (1 - v)), 1, 1); });
  }),
  bars: scopeTheme('Bars', ({ ctx, W, H, A, state }) => {
    const bottom = Math.round(H * 0.68), h = H * 0.22;
    state.cpu.forEach((v, i) => {
      if ((W - state.cpu.length + i) % 3) return;
      const x = W - state.cpu.length + i, bh = Math.max(1, Math.round(h * v));
      ctx.fillStyle = `rgba(${A[0]},${A[1]},${A[2]},0.26)`;
      for (let y = 0; y < bh; y++) if (!((x + y) & 1) || y >= bh - 2) ctx.fillRect(x, bottom - y, 2, 1);
    });
    ctx.fillStyle = 'rgba(176,176,176,0.12)'; ctx.fillRect(0, bottom + 2, W, 1);
  }),
  pulse: scopeTheme('Pulse', ({ ctx, W, H, A, state }) => {
    const base = Math.round(H * 0.56), amp = H * 0.1, cpu = state.last ? state.last.cpu : 0;
    if (!state.buf) { state.buf = new Array(W).fill(null); state.x = 0; }
    if (state.buf.length !== W) { state.buf = new Array(W).fill(null); state.x = 0; }
    for (let k = 0; k < 2; k++) { // 2 columns per frame
      const x = state.x, p = (x % 48) / 48;
      const e = p < 0.25 ? Math.sin(p / 0.25 * Math.PI) * 0.12 : p > 0.42 && p < 0.47 ? -0.25 : p >= 0.47 && p < 0.54 ? 1 : p >= 0.54 && p < 0.6 ? -0.3 : p > 0.7 && p < 0.9 ? Math.sin((p - 0.7) / 0.2 * Math.PI) * 0.2 : 0;
      state.buf[x] = Math.round(base - e * amp * (0.35 + cpu * 1.2));
      for (let g = 1; g <= 10; g++) state.buf[(x + g) % W] = null; // erase ahead of the beam
      state.x = (x + 1) % W;
    }
    ctx.fillStyle = `rgba(${A[0]},${A[1]},${A[2]},0.3)`;
    let prev = null;
    for (let x = 0; x < W; x++) {
      const y = state.buf[x];
      if (y === null) { prev = null; continue; }
      const a = prev === null ? y : Math.min(prev, y), b = prev === null ? y : Math.max(prev, y);
      ctx.fillRect(x, a, 1, b - a + 1); prev = y;
    }
    const hy = state.buf[(state.x + W - 1) % W];
    if (hy !== null) { ctx.fillStyle = `rgba(${A[0]},${A[1]},${A[2]},0.7)`; ctx.fillRect(Math.max(0, state.x - 2), hy - 1, 2, 3); }
  }),

  sigil: { label: 'Sigil', px: 2, draw({ ctx, W, H, f }) {
    const cx = W / 2, cy = H * 0.58, R = Math.min(W * 0.46, H * 0.4), rot = f * 0.0006;
    const dot = (x, y, a) => { x = Math.round(x); y = Math.round(y); if ((x + y) & 1) return; ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.fillRect(x, y, 1, 1); };
    for (let a = 0; a < 6.283; a += 0.5 / R) { dot(cx + Math.cos(a) * R, cy + Math.sin(a) * R, 0.2); dot(cx + Math.cos(a) * R * 0.14, cy + Math.sin(a) * R * 0.14, 0.2); }
    for (let k = 0; k < 3; k++) for (let th = 0; th < 3.2; th += 0.4 / R * 4) { // three spiral arms, 120° apart
      const ang = th + rot + k * 2.094, r = R * (0.14 + 0.78 * th / 3.2);
      dot(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, 0.22);
    }
  } },

  ascii: asciiTheme('ASCII', 6, (c, r, o) => {
    const v = (Math.sin(c * 0.35 + o.t) + Math.sin(r * 0.18 - o.t * 0.7) + Math.sin((c + r) * 0.12 + o.t * 0.5)) / 6 + 0.5;
    return ' ··:+*'[Math.floor(v * v * 6.6)];
  }),
  rain: asciiTheme('Rain', 4, (c, r, o) => {
    const col = o.state.cols[c], d = col.y - r;
    if (d < 0 || d > col.len) return '';
    return ['0123456789abcdef'[(c * 7 + r * 13 + Math.floor(o.f / 12)) & 15], d === 0 ? 0.5 : 0.28 * (1 - d / col.len)];
  }, ({ cols, rows, state }) => {
    if (!state.cols || state.cols.length !== cols) state.cols = Array.from({ length: cols }, () => ({ y: Math.random() * rows, v: 0.25 + Math.random() * 0.5, len: 5 + Math.random() * 12 }));
    state.cols.forEach((k) => { k.y += k.v; if (k.y - k.len > rows) { k.y = -Math.random() * 10; k.v = 0.25 + Math.random() * 0.5; } });
  }),
  terrain: asciiTheme('Terrain', 6, (c, r, o) => {
    const v = (Math.sin(c * 0.12 + o.t * 0.5) + Math.sin(r * 0.1 - o.t * 0.3) + Math.sin((c * 0.6 + r) * 0.07 + o.t * 0.2) + Math.sin(Math.hypot(c - o.cols / 2, r - o.rows / 2) * 0.15)) / 8 + 0.5, fr = (v * 9) % 1;
    return fr < 0.14 ? '+' : fr < 0.3 ? '-' : '';
  }),
  ripple: asciiTheme('Ripple', 5, (c, r, o) => {
    const d = Math.hypot((c - o.cols / 2) * 8, (r - o.rows * 0.6) * 12) / 10, v = (Math.sin(d - o.t * 6) + 1) / 2;
    return ' ··:oO'[Math.floor(v * v * v * 6)];
  }),
  stars: asciiTheme('Stars', 6, (c, r, o) => {
    const h = (((c * 73856093) ^ (r * 19349663)) >>> 0) % 1000;
    return h < 22 ? '.·+*'[Math.floor((Math.sin(o.f * 0.012 + h) + 1) / 2 * 3.99)] : '';
  }),
  sea: asciiTheme('Sea', 6, (c, r, o) => {
    const yw = o.rows * 0.55 + Math.sin(c * 0.2 + o.t * 2) * 2.5 + Math.sin(c * 0.07 - o.t) * 2;
    if (Math.round(yw) === r) return '~';
    return r > yw && (c + r * 3 + Math.floor(o.t * 4)) % 7 === 0 ? '·' : '';
  }),
  fire: asciiTheme('Fire', 4, (c, r, o) => {
    const h = o.state.h[r * o.cols + c];
    return h < 3 ? '' : [' .:-=+*#%@'[Math.min(9, Math.floor(h / 2.6))], 0.1 + h / 24 * 0.22];
  }, ({ cols, rows, state }) => {
    if (!state.h || state.h.length !== cols * rows) state.h = new Uint8Array(cols * rows);
    const h = state.h;
    for (let c = 0; c < cols; c++) h[(rows - 1) * cols + c] = Math.random() < 0.7 ? 24 : 6;
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols; c++) {
      const src = h[(r + 1) * cols + Math.min(cols - 1, Math.max(0, c + Math.floor(Math.random() * 3) - 1))];
      h[r * cols + c] = Math.max(0, src - Math.floor(Math.random() * 3));
    }
  }),
  life: asciiTheme('Life', 12, (c, r, o) => (o.state.g[r * o.cols + c] ? ['#', 0.28] : ''), ({ cols, rows, state }) => {
    const n = cols * rows;
    if (!state.g || state.g.length !== n || state.age > 300 || state.g.reduce((a, b) => a + b, 0) < 6) {
      state.g = Uint8Array.from({ length: n }, () => (Math.random() < 0.22 ? 1 : 0)); state.age = 0;
    }
    const g = state.g, nx = new Uint8Array(n);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      let k = 0;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (dr || dc) k += g[((r + dr + rows) % rows) * cols + ((c + dc + cols) % cols)];
      nx[r * cols + c] = k === 3 || (k === 2 && g[r * cols + c]) ? 1 : 0;
    }
    state.g = nx; state.age++;
  }),

  sweep: { label: 'Sweep', px: 2, draw({ ctx, W, H, f }) {
    const trail = 50, y0 = Math.floor((f * 0.35) % (H + trail));
    for (let d = 0; d < trail; d++) {
      const y = y0 - d; if (y < 0 || y >= H) continue;
      ctx.fillStyle = `rgba(255,255,255,${d === 0 ? 0.16 : 0.07 * (1 - d / trail)})`;
      if (d === 0) ctx.fillRect(0, y, W, 1);
      else for (let x = y & 1; x < W; x += 2) ctx.fillRect(x, y, 1, 1);
    }
  } },

  off: { label: 'Off' },
};

function hslToRgb(h, sat = 100) { // lightness fixed at 60% so every pick stays readable on black
  const a = (sat / 100) * 0.4;
  const f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (0.6 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return [f(0), f(8), f(4)];
}

function mountBackground(container, name) {
  const theme = BG_THEMES[name];
  if (!theme || !theme.draw) return () => {};
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;filter:url(#bg-gain);' + (theme.px > 1 ? 'image-rendering:pixelated;' : '');
  container.prepend(canvas);
  const ctx = canvas.getContext('2d');
  const PX = theme.px, state = {};
  const size = () => { canvas.width = Math.ceil(container.clientWidth / PX); canvas.height = Math.ceil(container.clientHeight / PX); };
  size();
  const ro = new ResizeObserver(size); ro.observe(container);
  const cleanup = theme.init ? theme.init({ state }) : null;
  let f = 0, raf;
  (function loop() {
    f += reduceMotion ? 0.2 : 1;
    if (!theme.every || Math.floor(f) % theme.every === 0) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      theme.draw({ ctx, W: canvas.width, H: canvas.height, f: Math.floor(f), PX, A: [232, 132, 10], state });
    }
    raf = requestAnimationFrame(loop);
  })();
  return () => { cancelAnimationFrame(raf); ro.disconnect(); canvas.remove(); if (cleanup) cleanup(); };
}
