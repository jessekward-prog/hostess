const path = require('path');
const express = require('express');
const qrcode = require('qrcode');
const engine = require('./lib/engine');
const guard = require('./lib/guard');
const settings = require('./lib/settings');
const ailink = require('./lib/ailink');
const autoupdate = require('./lib/autoupdate');
const auth = require('./lib/auth');
const tunnel = require('./lib/tunnel');
const registry = require('./lib/registry');

const app = express();
const PORT = 5300;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/auth/verify', (req, res) => {
  const { pin } = req.body || {};
  if (auth.verifyPin(req, res, String(pin || ''))) return res.json({ ok: true });
  res.status(401).json({ error: 'wrong pin' });
});

app.use('/api', auth.middleware);

app.post('/api/tunnel/start', async (req, res) => {
  try {
    const hub = await tunnel.start(tunnel.HUB_KEY, PORT);
    const pin = auth.rotatePin();
    const url = `${hub.url}/?pin=${pin}`;
    const qr = await qrcode.toDataURL(url);
    res.json({ url: hub.url, pin, qr, startedAt: hub.startedAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tunnel/stop', (req, res) => {
  tunnel.stopAll();
  auth.clearPin();
  res.json({ ok: true });
});

app.get('/api/tunnel/status', async (req, res) => {
  const status = tunnel.status();
  if (status.hub) {
    status.hub.pin = auth.getPin();
    status.hub.qr = await qrcode.toDataURL(`${status.hub.url}/?pin=${auth.getPin()}`);
  }
  res.json(status);
});

app.post('/api/apps/:name/expose', async (req, res) => {
  if (!tunnel.hubActive()) return res.status(400).json({ error: 'Go Online first' });
  const record = registry.get(req.params.name);
  if (!record) return res.status(404).json({ error: 'No such app' });
  try {
    const { url } = await tunnel.start(req.params.name, record.port);
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/apps', async (req, res) => {
  try {
    res.json(await engine.listApps());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/apps', async (req, res) => {
  const { source } = req.body || {};
  if (!source) return res.status(400).json({ error: 'Missing "source" (repo URL or local path)' });
  try {
    const record = await engine.deployApp(source);
    res.json(record);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/apps/:name/redeploy', async (req, res) => {
  try {
    res.json(await engine.redeployApp(req.params.name));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/apps/:name/stop', async (req, res) => {
  try {
    await engine.stopApp(req.params.name);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/apps/:name/start', async (req, res) => {
  try {
    await engine.startApp(req.params.name);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/apps/:name', async (req, res) => {
  try {
    await engine.removeApp(req.params.name);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/apps/:name/env', async (req, res) => {
  const { values } = req.body || {};
  if (!values || typeof values !== 'object') return res.status(400).json({ error: 'Missing "values" object' });
  try {
    res.json(await engine.setEnvValues(req.params.name, values));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/apps/:name/scan', async (req, res) => {
  try {
    res.json(await engine.scanApp(req.params.name));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Syncs against an app's own /api/lm (shelf-cmd's MY AI, macro-cmd's Local AI
// panel) using SYNC_SECRET from this app's own env values — see lib/ailink.js.
app.get('/api/apps/:name/ailink', async (req, res) => {
  res.json(await ailink.probe(req.params.name));
});

app.put('/api/apps/:name/ailink', async (req, res) => {
  try {
    res.json(await ailink.update(req.params.name, req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/apps/:name/logs', async (req, res) => {
  try {
    res.type('text/plain').send(await engine.getLogs(req.params.name));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Lists what the configured endpoint actually has loaded, so the picker
// offers real ids instead of asking someone to type one from memory.
app.get('/api/lm', async (req, res) => {
  const { url, model } = guard.lmConfig();
  const out = { url, selected: model, models: [], apiKeySet: !!settings.get('lmApiKey') };
  if (!url) return res.json(out);
  try {
    const { apiKey } = guard.lmConfig();
    const r = await fetch(`${url}/v1/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`endpoint returned ${r.status}`);
    const data = await r.json();
    out.models = (data.data || []).map((m) => m.id).filter(Boolean);
  } catch (err) {
    out.error = err.message;
  }
  res.json(out);
});

app.put('/api/lm', (req, res) => {
  if (typeof req.body.url === 'string') settings.set('lmUrl', req.body.url.trim().replace(/\/+$/, ''));
  if (typeof req.body.apiKey === 'string') settings.set('lmApiKey', req.body.apiKey.trim());
  if (typeof req.body.model === 'string') settings.set('lmModel', req.body.model.trim());
  const { url, model } = guard.lmConfig();
  res.json({ url, selected: model, apiKeySet: !!settings.get('lmApiKey') });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`hostess dashboard: http://localhost:${PORT}`);
  autoupdate.start(console.log);
});

process.on('SIGTERM', () => { tunnel.stopAll(); process.exit(0); });
process.on('SIGINT', () => { tunnel.stopAll(); process.exit(0); });
