const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const guard = require('./guard');
const settings = require('./settings');
const registry = require('./registry');

// Forge: describe an app, watch a local model write it, install it as a normal Hostess app.
// The model only ever writes public/index.html; the backend is the fixed scaffold in
// forge-scaffold/, so every forged app has the same small, already-tested API and passes the
// rules by construction. Projects live in forge/<name>/ (gitignored) and are deployed from there.
const FORGE_DIR = path.join(__dirname, '..', 'forge');
const SCAFFOLD_DIR = path.join(__dirname, 'forge-scaffold');
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$/;
const KIT_PATH = path.join(__dirname, '..', 'public', 'forge-kit.js');
const KIT_RE = /<script id="forge-kit">[\s\S]*?<\/script>\n?/;

// The page the model writes calls store/askAI/notify; the kit defining them goes in at save time
// and comes back out on load, so the model only ever sees its own code.
function withKit(html) {
  const tag = `<script id="forge-kit">${fs.readFileSync(KIT_PATH, 'utf8')}</script>\n`;
  const clean = html.replace(KIT_RE, '');
  return /<head[^>]*>/i.test(clean) ? clean.replace(/<head[^>]*>/i, (m) => `${m}\n${tag}`) : tag + clean;
}
const withoutKit = (html) => html.replace(KIT_RE, '');

// Rules for every pass that writes the page. The craft bar is ported from the exe-app-build skill.
const SYSTEM_PROMPT = `You build small personal web apps for one household. Each app runs on Hostess, a home server.

Answer with ONE complete HTML file: start with <!doctype html>, end with </html>. All CSS and JavaScript inline. After </html>, write one short plain sentence saying what you built or changed. Nothing before the doctype.

These functions already exist on the page. Use them; never define them yourself and never call fetch for data:
- await store.get(key, fallback)  -> the value saved under key, or fallback when nothing is saved yet (first launch)
- await store.set(key, value)     -> saves any JSON value. Keys: letters, numbers, - and _ only.
- await askAI(prompt, system)     -> text from the household's local AI model. Slow (seconds): show a loading state.
- await notify(title, message)    -> a notification on the owner's phone.
All four throw an Error with a readable message when they fail: catch it and show err.message in the page.

Rules:
- Save everything the user enters with store.set, never localStorage, so it is the same on every device. Load it with store.get on start, always passing a fallback ([] for lists, {} for objects).
- When the app tracks something over time, save a list of dated entries (not just the latest value) so history and totals can be worked out.
- Put all JavaScript in one <script> at the end of <body>. Any function that uses await must be declared async.
- Mobile first: works at 375px wide, touch targets at least 44px, no horizontal scroll.
- No external scripts, fonts or images. Use system fonts and inline SVG.
- Plain words in the interface. The user is not technical.
- Give the page a short <title> naming the app.

Craft (every app, whatever its colours):
- Colours as CSS variables on :root (background, surface, text, muted text, accent), used everywhere; no stray hex values.
- Cards with one consistent radius and spacing scale; small uppercase labels for secondary text.
- Styled buttons and inputs, never browser defaults, with hover and press feedback (transitions).
- Real states: an empty state on first launch, a loading state while data loads, errors shown in the page.`;

// First stage: turn a one-line request into a spec the person can check before anything is built.
const SPEC_PROMPT = `You plan small personal web apps for one household: a personal tool, not a product. Read the request and answer with ONLY this JSON object, nothing before or after it:
{
  "title": "short app name",
  "summary": "one sentence: what the app does",
  "assumptions": ["up to 4 things you are assuming, e.g. who uses it, what it remembers"],
  "data": [{"key": "storage key (letters, numbers, - or _)", "holds": "what is saved there, e.g. list of {name, aisle, done}"}],
  "screens": ["each screen or section of the page"],
  "core": ["each feature the request asks for directly, short"],
  "extras": [{"label": "a feature apps like this usually have that the request did not ask for", "why": "one short reason"}],
  "style": {"mood": "a few words", "background": "#hex", "surface": "#hex", "text": "#hex", "accent": "#hex"}
}
Give 4 to 6 extras. Pick style colours that suit what the app is for, with readable contrast.`;

const STOP = new Set('the and for with that this from your you app apps make build want have will can into using use what when where which who how its are was were but not all any one some like just need needs page site web simple small little track tracker show list'.split(' '));

function terms(text) {
  return [...new Set((text.toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((t) => !STOP.has(t)))];
}

function walkMarkdown(dir, out = [], depth = 0) {
  if (depth > 6 || out.length > 3000) return out;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkMarkdown(full, out, depth + 1);
    else if (e.name.endsWith('.md')) out.push(full);
  }
  return out;
}

// ponytail: plain keyword scoring (title hits weigh 4x body hits, idf-weighted), re-read on every
// request. Fine for a few thousand notes; past that, cache by mtime or add embeddings.
function retrieve(prompt, k = 4) {
  const vault = settings.get('forgeVault');
  if (!vault) return { vault: null, notes: [] };
  const q = terms(prompt);
  if (!q.length) return { vault, notes: [] };
  const docs = walkMarkdown(vault).map((file) => {
    let body = '';
    try { body = fs.readFileSync(file, 'utf8'); } catch { /* unreadable */ }
    return { file, title: path.basename(file, '.md'), body, lower: body.toLowerCase() };
  });
  const df = Object.fromEntries(q.map((t) => [t, docs.filter((d) => d.lower.includes(t)).length]));
  const scored = docs.map((d) => {
    const titleLower = d.title.toLowerCase();
    let score = 0;
    const matched = [];
    for (const t of q) {
      if (!df[t]) continue;
      const idf = Math.log(1 + docs.length / df[t]);
      const hits = Math.min(d.lower.split(t).length - 1, 10) + (titleLower.includes(t) ? 4 : 0);
      if (hits) { score += hits * idf; matched.push(t); }
    }
    return { ...d, score, matched };
  }).filter((d) => d.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
  return {
    vault,
    notes: scored.map((d) => ({
      title: d.title,
      path: path.relative(vault, d.file),
      score: Math.round(d.score * 10) / 10,
      matched: d.matched,
      excerpt: d.body.replace(/^---[\s\S]*?---\s*/, '').slice(0, 1800),
    })),
  };
}

function notesBlock(notes) {
  if (!notes.length) return '';
  return `\n\nThe owner's notes that may be relevant (follow any preferences in them; ignore the rest):\n`
    + notes.map((n) => `\n--- ${n.title} ---\n${n.excerpt}`).join('\n');
}

function styleBlock(spec, style) {
  if (style && style.custom) return `Style, as the owner describes it: ${style.custom}`;
  const st = spec.style || {};
  return `Style: ${st.mood || 'clean'}. Colours: background ${st.background}, surface ${st.surface}, text ${st.text}, accent ${st.accent}.`;
}

// stage 'spec': request -> JSON spec. stage 'step': one build step against the current file.
// Anything else is a free-form change (or a single-shot build) from the chat.
function buildMessages({ stage, requests, html, notes, spec, plan, step, style }) {
  const latest = requests[requests.length - 1];
  if (stage === 'spec') {
    return [{ role: 'system', content: SPEC_PROMPT + notesBlock(notes) }, { role: 'user', content: latest }];
  }
  if (stage === 'step') {
    const brief = `App spec:\n${JSON.stringify({ ...spec, style: undefined, extras: undefined }, null, 1)}\n\n${styleBlock(spec, style)}\n\nBuild plan:\n${plan.map((p, i) => `${i + 1}. ${p.title}: ${p.does}`).join('\n')}`;
    const now = plan[step];
    const user = html
      ? `${brief}\n\nSteps 1-${step} are done. Current file:\n${html}\n\nNow do step ${step + 1} only: ${now.title}: ${now.does}\nKeep everything that already works. Return the complete updated file.`
      : `${brief}\n\nDo step 1 only: ${now.title}: ${now.does}\nLater steps add the rest, but lay the page out for all the screens now. Return the complete file.`;
    return [{ role: 'system', content: SYSTEM_PROMPT + (step === 0 ? notesBlock(notes) : '') }, { role: 'user', content: user }];
  }
  const user = html
    ? `The app was built from these requests so far:\n${requests.slice(0, -1).map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\nCurrent file:\n${html}\n\nChange it: ${latest}\n\nReturn the complete updated file.`
    : latest;
  return [{ role: 'system', content: SYSTEM_PROMPT + notesBlock(notes) }, { role: 'user', content: user }];
}

// Pipes the model's stream to `emit` as {type:'reasoning'|'content'|'usage', ...} events.
async function generate({ stage, requests, html, spec, plan, step, style, model, think, fix }, emit, signal) {
  const cfg = guard.lmConfig();
  if (!cfg.url) throw new Error('No local AI configured. Connect one in MY AI first.');
  // Notes only matter where the model decides something: the spec, the first build step, and
  // chat changes. An auto-fix request is an error message; searching with it only finds noise.
  const wantsNotes = stage !== 'step' || step === 0;
  const { vault, notes } = wantsNotes ? retrieve((fix ? requests.slice(0, -1) : requests).join('\n')) : { vault: settings.get('forgeVault') || null, notes: [] };
  const messages = buildMessages({ stage, requests, html, notes, spec, plan, step, style });
  const useModel = model || cfg.model;
  emit({ type: 'context', stage: stage || 'change', skippedNotes: !wantsNotes, vault, notes: notes.map(({ excerpt, ...n }) => n), model: useModel, system: messages[0].content, user: messages[1].content });

  const res = await fetch(`${cfg.url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cfg.apiKey && { Authorization: `Bearer ${cfg.apiKey}` }) },
    // reasoning_effort 'none' is the only off-switch LM Studio honours for Qwen3.6-based models
    // (Bonsai ignores /no_think and enable_thinking); other models accept and ignore it.
    body: JSON.stringify({ model: useModel || undefined, messages, stream: true, stream_options: { include_usage: true }, temperature: 0.4, ...(!think && { reasoning_effort: 'none' }) }),
    signal,
  });
  if (!res.ok) throw new Error(`local AI returned HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      let data;
      try { data = JSON.parse(payload); } catch { continue; }
      if (data.error) throw new Error(data.error.message || String(data.error));
      const delta = data.choices?.[0]?.delta || {};
      if (delta.reasoning_content) emit({ type: 'reasoning', text: delta.reasoning_content });
      if (delta.content) emit({ type: 'content', text: delta.content });
      if (data.usage) emit({ type: 'usage', usage: data.usage });
    }
  }
}

// Stand-in for a forged app's own /api/ai while it runs in the preview.
async function previewAi({ prompt, system, model }) {
  const cfg = guard.lmConfig();
  if (!cfg.url) throw new Error('No local AI configured.');
  const res = await fetch(`${cfg.url}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cfg.apiKey && { Authorization: `Bearer ${cfg.apiKey}` }) },
    body: JSON.stringify({
      model: model || cfg.model || undefined,
      messages: [...(system ? [{ role: 'system', content: String(system) }] : []), { role: 'user', content: String(prompt || '') }],
      reasoning_effort: 'none',
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`local AI returned HTTP ${res.status}`);
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

function listProjects() {
  if (!fs.existsSync(FORGE_DIR)) return [];
  return fs.readdirSync(FORGE_DIR).filter((n) => NAME_RE.test(n)).map((name) => {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(FORGE_DIR, name, 'forge.json'), 'utf8'));
      return { name, description: meta.description || '', updated: meta.updated, installed: !!registry.get(name) };
    } catch { return null; }
  }).filter(Boolean).sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
}

function getProject(name) {
  if (!NAME_RE.test(name)) throw new Error('bad project name');
  const dir = path.join(FORGE_DIR, name);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'forge.json'), 'utf8'));
  return { name, ...meta, html: withoutKit(fs.readFileSync(path.join(dir, 'public', 'index.html'), 'utf8')), installed: !!registry.get(name) };
}

// Writes forge/<name>/ as a complete deployable repo: scaffold + the page + app.yaml.
function saveProject({ name, html, description, requests, spec }) {
  if (!NAME_RE.test(name || '')) throw new Error('Name must be lowercase letters, numbers and hyphens, 2-50 characters.');
  if (typeof html !== 'string' || !/<\/html>/i.test(html)) throw new Error('The page is incomplete. Let it finish generating first.');
  const dir = path.join(FORGE_DIR, name);
  // Never write (and later deploy) over an app this Forge didn't make: that's someone's install and its data.
  if (registry.get(name) && !fs.existsSync(dir)) throw new Error(`An app called "${name}" is already installed and wasn't made in Forge. Pick another name.`);

  fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
  for (const f of ['Dockerfile', 'server.js']) fs.copyFileSync(path.join(SCAFFOLD_DIR, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'public', 'index.html'), withKit(html));
  const desc = String(description || '').trim().slice(0, 200);
  fs.writeFileSync(path.join(dir, 'app.yaml'), yaml.dump({ name, port: 3000, dataDir: '/data', ...(desc && { description: desc }) }));
  fs.writeFileSync(path.join(dir, 'forge.json'), JSON.stringify({ description: desc, requests: requests || [], ...(spec && typeof spec === 'object' && { spec }), updated: new Date().toISOString() }, null, 2));
  return dir;
}

function deleteProject(name) {
  if (!NAME_RE.test(name)) throw new Error('bad project name');
  fs.rmSync(path.join(FORGE_DIR, name), { recursive: true, force: true });
}

module.exports = { generate, previewAi, retrieve, listProjects, getProject, saveProject, deleteProject };
