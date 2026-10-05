// Built by Hostess Forge. The page in public/index.html talks to these routes:
//   GET/PUT /api/data/<key>   JSON saved to /data (survives redeploys)
//   POST    /api/files        a photo or document (raw body, ?name=) -> { id, url, name, type, size }
//   GET/DELETE /api/files/<id>
//   POST    /api/ai           { prompt, system? } -> { text }, via the Hostess library
//   POST    /api/push         { title?, message } -> a phone notification
// No dependencies, so the image builds without npm.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = '/data';
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
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
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

http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  try {
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
      const id = require('crypto').randomBytes(12).toString('hex');
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
      res.writeHead(200, { 'Content-Type': meta.type, 'Content-Disposition': `inline; filename="${meta.name.replace(/"/g, '')}"`, 'Cache-Control': 'private, max-age=31536000, immutable' });
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
