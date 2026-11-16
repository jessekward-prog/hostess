// Run: node lib/forge-scaffold/gate.test.js
// Starts the scaffold server on a temp data folder and checks the PIN gate end to end.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const a = require('assert');

const PORT = 39417;
const B = `http://127.0.0.1:${PORT}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-gate-'));
fs.mkdirSync(path.join(tmp, 'public'));
fs.copyFileSync(path.join(__dirname, 'server.js'), path.join(tmp, 'server.js'));
fs.writeFileSync(path.join(tmp, 'public', 'index.html'), '<html>THE-APP</html>');
fs.writeFileSync(path.join(tmp, 'public', 'manifest.json'), '{"name":"x"}');

function start(env = {}) {
  const proc = spawn(process.execPath, ['server.js'], { cwd: tmp, env: { ...process.env, PORT, DATA_DIR: path.join(tmp, 'data'), APP_PIN: '', ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
  return new Promise((resolve) => proc.stdout.once('data', () => resolve(proc)));
}
function stop(proc) {
  return new Promise((resolve) => { proc.once('exit', (code) => resolve(code)); proc.kill('SIGTERM'); });
}

let cookie = '';
async function req(p, opt = {}) {
  const r = await fetch(B + p, { ...opt, headers: { 'Content-Type': 'application/json', ...(cookie && { cookie }), ...(opt.headers || {}) } });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return { status: r.status, text: await r.text(), headers: r.headers, sc };
}
const post = (p, body, headers) => req(p, { method: 'POST', body: JSON.stringify(body), headers });

(async () => {
  fs.mkdirSync(path.join(tmp, 'data'));
  let proc = await start();
  let r = await req('/api/state'); a.deepEqual(JSON.parse(r.text), { needsSetup: true, locked: true });
  for (const [p, opt] of [['/api/data/things'], ['/api/ai', { method: 'POST', body: '{}' }], ['/api/push', { method: 'POST', body: '{}' }], ['/api/files', { method: 'POST', body: 'x' }], ['/api/files/' + 'a'.repeat(24)]]) {
    a.equal((await req(p, opt)).status, 401, `${p} is locked before a PIN is set`);
  }
  r = await req('/'); a.ok(r.text.includes('Set a PIN') && !r.text.includes('THE-APP'), 'setup page, not the app');
  r = await req('/some/deep/link'); a.ok(!r.text.includes('THE-APP'), 'the index.html fallback is gated too');
  r = await req('/manifest.json'); a.equal(r.text, '{"name":"x"}', 'manifest is open and served as-is');
  a.equal((await post('/api/setup', { pin: '12' })).status, 400, 'short PIN refused');
  r = await post('/api/setup', { pin: '4821' }); a.equal(r.status, 200);
  a.ok(/HttpOnly/.test(r.sc) && /SameSite=Lax/.test(r.sc) && !/Secure/.test(r.sc), 'cookie flags over http');
  a.equal((await post('/api/setup', { pin: '0000' })).status, 409, 'setup is closed once a PIN exists');
  a.equal((await req('/api/data/things', { method: 'PUT', body: '{"a":1}' })).status, 200, 'an unlocked session can write');
  a.ok((await req('/')).text.includes('THE-APP'), 'app page when unlocked');
  const good = cookie;
  cookie = good.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'));
  a.equal((await req('/api/data/things')).status, 401, 'tampered cookie refused');
  cookie = '';
  a.ok((await req('/')).text.includes('Enter PIN'), 'unlock page when locked');
  r = await post('/api/unlock', { pin: '4821' }, { 'x-forwarded-proto': 'https' }); a.equal(r.status, 200); a.ok(/Secure/.test(r.sc), 'Secure over https');
  a.equal((await req('/api/data/things')).text, '{"a":1}');

  r = await fetch(B + '/api/files?name=x.svg', { method: 'POST', headers: { cookie, 'Content-Type': 'image/svg+xml' }, body: '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>' });
  r = await req((await r.json()).url);
  a.ok(/^attachment/.test(r.headers.get('content-disposition')) && r.headers.get('x-content-type-options') === 'nosniff', 'an uploaded SVG downloads instead of running');
  r = await fetch(B + '/api/files?name=p.png', { method: 'POST', headers: { cookie, 'Content-Type': 'image/png' }, body: 'x' });
  a.ok(/^inline/.test((await req((await r.json()).url)).headers.get('content-disposition')), 'a photo opens inline');

  const session = cookie;
  cookie = '';
  const tunnel = { 'cf-connecting-ip': '203.0.113.7' };
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await post('/api/unlock', { pin: '0000' }, tunnel)).status);
  a.deepEqual(codes, [401, 401, 401, 401, 401, 429], 'wrong guesses are limited');
  a.equal((await post('/api/unlock', { pin: '4821' }, tunnel)).status, 429, 'the right PIN is refused during the wait');
  a.equal((await post('/api/unlock', { pin: '4821' })).status, 200, 'a different caller is unaffected');

  const t0 = Date.now();
  a.equal(await stop(proc), 0, 'exits cleanly on SIGTERM');
  a.ok(Date.now() - t0 < 5000, 'and promptly');

  proc = await start(); // a restart keeps the PIN and existing sessions
  cookie = session;
  a.equal((await req('/api/data/things')).status, 200, 'session survives a restart');
  await stop(proc);

  proc = await start({ APP_PIN: '9999' }); // APP_PIN overrides, and signs old sessions out
  a.equal((await req('/api/data/things')).status, 401, 'old session is signed out when the PIN changes');
  cookie = '';
  a.equal((await post('/api/unlock', { pin: '4821' })).status, 401, 'the old PIN no longer works');
  a.equal((await post('/api/unlock', { pin: '9999' })).status, 200, 'APP_PIN works');
  await stop(proc);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('forge scaffold gate: all checks passed');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
