// Built by Hostess Forge. The page in public/index.html talks to these routes:
//   GET/PUT /api/data/<key>   JSON saved to /data (survives redeploys)
//   POST    /api/files        a photo or document (raw body, ?name=) -> { id, url, name, type, size }
//   GET/DELETE /api/files/<id>
//   POST    /api/ai           { prompt, system? } -> { text }, via the Hostess library
//   POST    /api/push         { title?, message } -> a phone notification
//   GET /api/state, POST /api/setup, /api/unlock, /api/lock   the PIN gate in front of all of it
// No dependencies, so the image builds without npm.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || '/data';
const PUBLIC_DIR = path.join(__dirname, 'public');
const KEY_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

const FILES_DIR = path.join(DATA_DIR, 'files');
const FILE_ID_RE = /^[a-f0-9]{24}$/;
const MAX_FILE = 25e6;
fs.mkdirSync(FILES_DIR, { recursive: true });

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('That file is too big (25 MB at most).')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type });
  // A file read from disk (manifest.json) is already text: stringify only real objects.
  res.end(type === 'application/json' && typeof body !== 'string' && !Buffer.isBuffer(body) ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 5e6) { reject(new Error('body too large')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks)) : null); }
      catch { reject(new Error('body must be JSON')); }
    });
  });
}

// ── PIN gate ──
// Every route under /api/ and the page itself sit behind a PIN. First visit sets it; APP_PIN (set
// on the app's card in Hostess) presets or overrides it. The web manifest, icons and other static
// files stay open so the app can still be installed to a home screen.
const PIN_FILE = path.join(DATA_DIR, 'pin.json');
const KEY_FILE = path.join(DATA_DIR, 'session.key');
const SESSION_MS = 90 * 24 * 60 * 60 * 1000;
const COOKIE = 'forge_session';

function storedPin() {
  try { return JSON.parse(fs.readFileSync(PIN_FILE, 'utf8')); } catch { return null; }
}
function sessionKey() {
  try { return fs.readFileSync(KEY_FILE, 'utf8'); } catch { /* first run */ }
  const key = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(KEY_FILE, key, { mode: 0o600 });
  return key;
}
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest();
const scrypt = (pin, salt) => crypto.scryptSync(String(pin), salt, 32);
function needsSetup() { return !process.env.APP_PIN && !storedPin(); }
function pinMatches(pin) {
  // Equal-length digests on both sides, so the comparison never leaks where a guess went wrong.
  if (process.env.APP_PIN) return crypto.timingSafeEqual(sha(pin), sha(process.env.APP_PIN));
  const s = storedPin();
  return !!s && crypto.timingSafeEqual(scrypt(pin, s.salt), Buffer.from(s.hash, 'hex'));
}
// Changing the PIN changes this, which signs every session out.
function pinVersion() { return process.env.APP_PIN ? sha(process.env.APP_PIN).toString('hex') : (storedPin() || {}).hash || ''; }
function sign(ts) { return crypto.createHmac('sha256', sessionKey()).update(`${ts}|${pinVersion()}`).digest('hex'); }
function unlocked(req) {
  const m = /(?:^|;\s*)forge_session=(\d{1,16})\.([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '');
  if (!m || needsSetup()) return false;
  const age = Date.now() - Number(m[1]);
  return age >= 0 && age < SESSION_MS && crypto.timingSafeEqual(Buffer.from(m[2]), Buffer.from(sign(m[1])));
}
function sessionCookie(req) {
  const ts = Date.now();
  // Secure only over https: Safari drops a Secure cookie on http://localhost.
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `${COOKIE}=${ts}.${sign(ts)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`;
}

// Wrong guesses: 5 free per caller, then a wait that doubles from 30s to 15 min. Callers arriving
// through a public tunnel also share one cap, so rotating addresses does not help; someone on the
// machine itself never shares it, so a stranger cannot lock the owner out.
const fails = new Map();
let tunnelFails = [];
function tooMany(req) {
  const viaTunnel = req.headers['cf-connecting-ip'];
  const rec = fails.get(viaTunnel || req.socket.remoteAddress);
  tunnelFails = tunnelFails.filter((t) => Date.now() - t < 10 * 60 * 1000);
  return (rec && Date.now() < rec.until) || (viaTunnel && tunnelFails.length >= 50);
}
function noteFail(req) {
  const viaTunnel = req.headers['cf-connecting-ip'];
  const who = viaTunnel || req.socket.remoteAddress;
  const rec = fails.get(who) || { n: 0, until: 0 };
  rec.n += 1;
  if (rec.n >= 5) rec.until = Date.now() + Math.min(30000 * 2 ** (rec.n - 5), 15 * 60 * 1000);
  fails.set(who, rec);
  if (viaTunnel) tunnelFails.push(Date.now());
}

const PIN_PAGE = (setup) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>${setup ? 'Set a PIN' : 'Enter PIN'}</title>
<style>
  html{color-scheme:dark}body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#000;color:#b0b0b0;font:16px ui-monospace,Menlo,Consolas,monospace;padding:20px;box-sizing:border-box}
  form{display:flex;flex-direction:column;gap:12px;width:280px;max-width:100%;background:#111;border:1px solid #333;border-radius:12px;padding:24px}
  h1{font:700 22px Georgia,serif;color:#fff;margin:0}p{margin:0;font-size:13px;line-height:1.5}
  input{font:inherit;font-size:20px;letter-spacing:.3em;text-align:center;background:#000;color:#fff;border:1px solid #333;border-radius:8px;padding:10px;min-height:44px}
  input:focus{outline:none;border-color:#fff}button{font:inherit;font-weight:600;background:#fff;color:#000;border:0;border-radius:8px;padding:11px;min-height:44px;cursor:pointer}
  #err{color:#ff9a90;min-height:1.5em}
</style></head><body><form id="f">
<h1>${setup ? 'Set a PIN' : 'Enter PIN'}</h1>
<p>${setup ? 'Choose 4 to 12 digits. You will need it to open this app.' : 'This app is locked.'}</p>
<input id="pin" type="password" inputmode="numeric" autocomplete="${setup ? 'new-password' : 'current-password'}" maxlength="12" aria-label="PIN" autofocus>
${setup ? '<input id="again" type="password" inputmode="numeric" autocomplete="new-password" maxlength="12" aria-label="PIN again" placeholder="again">' : ''}
<button>${setup ? 'Set PIN' : 'Unlock'}</button><p id="err" role="alert"></p></form>
<script>
  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = document.getElementById('pin').value, again = document.getElementById('again'), err = document.getElementById('err');
    if (!/^[0-9]{4,12}$/.test(pin)) { err.textContent = 'Use 4 to 12 digits.'; return; }
    if (again && again.value !== pin) { err.textContent = 'The two PINs do not match.'; return; }
    const r = await fetch('${setup ? '/api/setup' : '/api/unlock'}', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) });
    if (r.ok) location.reload(); else err.textContent = (await r.json().catch(() => ({}))).error || 'That did not work.';
  });
</script></body></html>`;

async function gate(req, res, pathname) {
  if (pathname === '/api/state') return send(res, 200, { needsSetup: needsSetup(), locked: !unlocked(req) });
  if (pathname === '/api/setup' && req.method === 'POST') {
    if (!needsSetup()) return send(res, 409, { error: 'A PIN is already set.' }); // never lets a stranger replace one
    const pin = String(((await readBody(req)) || {}).pin || '');
    if (!/^[0-9]{4,12}$/.test(pin)) return send(res, 400, { error: 'Use 4 to 12 digits.' });
    const salt = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(PIN_FILE, JSON.stringify({ salt, hash: scrypt(pin, salt).toString('hex') }), { mode: 0o600 });
    res.setHeader('Set-Cookie', sessionCookie(req));
    return send(res, 200, { ok: true });
  }
  if (pathname === '/api/unlock' && req.method === 'POST') {
    if (tooMany(req)) return send(res, 429, { error: 'Too many wrong tries. Wait a little and try again.' });
    const pin = String(((await readBody(req)) || {}).pin || '');
    if (needsSetup() || !pinMatches(pin)) { noteFail(req); return send(res, 401, { error: 'Wrong PIN.' }); }
    fails.delete(req.headers['cf-connecting-ip'] || req.socket.remoteAddress);
    res.setHeader('Set-Cookie', sessionCookie(req));
    return send(res, 200, { ok: true });
  }
  if (pathname === '/api/lock' && req.method === 'POST') {
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    return send(res, 200, { ok: true });
  }
  if (unlocked(req)) return false; // carry on to the app
  if (pathname.startsWith('/api/')) return send(res, 401, { error: 'locked' });
  const file = path.join(PUBLIC_DIR, path.normalize(pathname));
  const isAsset = pathname !== '/' && path.extname(pathname) !== '.html' && file.startsWith(PUBLIC_DIR) && fs.existsSync(file) && fs.statSync(file).isFile();
  if (isAsset) return false; // manifest, icons, scripts: nothing private in them
  res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' });
  return res.end(PIN_PAGE(needsSetup()));
}

async function ai({ prompt, system }) {
  const url = (process.env.LM_STUDIO_URL || '').replace(/\/+$/, '');
  if (!url) throw new Error('No AI is connected to Hostess yet.');
  const key = process.env.LM_STUDIO_API_KEY;
  const r = await fetch(`${url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key && { Authorization: `Bearer ${key}` }) },
    body: JSON.stringify({
      model: process.env.LM_STUDIO_MODEL || undefined,
      messages: [...(system ? [{ role: 'system', content: String(system) }] : []), { role: 'user', content: String(prompt || '') }],
      reasoning_effort: 'none',
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!r.ok) throw new Error(`the AI answered HTTP ${r.status}`);
  const data = await r.json();
  return (data.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

async function push({ title, message }) {
  const url = process.env.NTFY_URL;
  if (!url) throw new Error('Push is not set up in Hostess.');
  const r = await fetch(url, {
    method: 'POST',
    headers: process.env.NTFY_TOKEN ? { Authorization: `Bearer ${process.env.NTFY_TOKEN}` } : {},
    body: JSON.stringify({ topic: process.env.NTFY_TOPIC, title: String(title || ''), message: String(message || '') }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`push answered HTTP ${r.status}`);
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  try {
    if ((await gate(req, res, pathname)) !== false) return;
    if (pathname.startsWith('/api/data/')) {
      const key = pathname.slice('/api/data/'.length);
      if (!KEY_RE.test(key)) return send(res, 400, { error: 'bad key' });
      const file = path.join(DATA_DIR, `${key}.json`);
      if (req.method === 'GET') return send(res, 200, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : 'null', 'application/json; charset=utf-8');
      if (req.method === 'PUT') {
        const body = await readBody(req);
        fs.writeFileSync(`${file}.tmp`, JSON.stringify(body));
        fs.renameSync(`${file}.tmp`, file);
        return send(res, 200, { ok: true });
      }
      if (req.method === 'DELETE') { fs.rmSync(file, { force: true }); return send(res, 200, { ok: true }); }
    }
    if (pathname === '/api/files' && req.method === 'POST') {
      const body = await readRaw(req, MAX_FILE);
      if (!body.length) return send(res, 400, { error: 'The file was empty.' });
      const id = crypto.randomBytes(12).toString('hex');
      const name = String(new URL(req.url, 'http://x').searchParams.get('name') || 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
      const type = String(req.headers['content-type'] || 'application/octet-stream').slice(0, 100);
      fs.writeFileSync(path.join(FILES_DIR, id), body);
      fs.writeFileSync(path.join(FILES_DIR, `${id}.json`), JSON.stringify({ name, type, size: body.length }));
      return send(res, 200, { id, url: `/api/files/${id}`, name, type, size: body.length });
    }
    if (pathname.startsWith('/api/files/')) {
      const id = pathname.slice('/api/files/'.length);
      if (!FILE_ID_RE.test(id)) return send(res, 400, { error: 'bad file id' });
      const file = path.join(FILES_DIR, id);
      if (req.method === 'DELETE') { fs.rmSync(file, { force: true }); fs.rmSync(`${file}.json`, { force: true }); return send(res, 200, { ok: true }); }
      if (!fs.existsSync(file)) return send(res, 404, { error: 'not found' });
      const meta = JSON.parse(fs.readFileSync(`${file}.json`, 'utf8'));
      // Photos and PDFs open in the page; anything that could run as a page here (HTML, SVG) downloads.
      const how = /^(image\/(png|jpeg|gif|webp)|application\/pdf)\s*(;|$)/i.test(meta.type) ? 'inline' : 'attachment';
      res.writeHead(200, { 'X-Content-Type-Options': 'nosniff', 'Content-Type': meta.type, 'Content-Disposition': `${how}; filename="${meta.name.replace(/"/g, '')}"`, 'Cache-Control': 'private, max-age=31536000, immutable' });
      return fs.createReadStream(file).pipe(res);
    }
    if (pathname === '/api/ai' && req.method === 'POST') return send(res, 200, { text: await ai(await readBody(req) || {}) });
    if (pathname === '/api/push' && req.method === 'POST') { await push(await readBody(req) || {}); return send(res, 200, { ok: true }); }
    if (pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });

    const file = path.join(PUBLIC_DIR, path.normalize(pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return send(res, 200, fs.readFileSync(path.join(PUBLIC_DIR, 'index.html')), TYPES['.html']);
    }
    send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
  } catch (err) {
    send(res, 500, { error: err.message });
  }
}).listen(PORT, () => console.log(`listening on ${PORT}`));

// As PID 1 the process gets no default signal handling, so without this every redeploy waits out
// Docker's 10 second grace period and then kills the app mid-write.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 4000).unref();
  });
}
