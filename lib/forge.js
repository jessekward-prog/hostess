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
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const FONTS = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Space+Grotesk:wght@400;500;600;700&display=swap';
// Current block, plus the older script-only kit so pages saved before the UI kit still strip cleanly.
const KIT_RE = /\n?<!--forge-kit-->[\s\S]*?<!--\/forge-kit-->\n?|<script id="forge-kit">[\s\S]*?<\/script>\n?/g;

// The page the model writes uses the UI kit's classes and calls store/askAI/notify/dates; the kit
// defining them goes in at save time (and in the preview) and comes back out on load, so the model
// only ever sees its own code. First in <head>, so the page's own <style> overrides it.
function kitHead() {
  const css = fs.readFileSync(path.join(PUBLIC_DIR, 'forge-kit.css'), 'utf8');
  const js = fs.readFileSync(path.join(PUBLIC_DIR, 'forge-kit.js'), 'utf8');
  return `<!--forge-kit--><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${FONTS}">\n<style id="forge-ui">${css}</style>\n<script>${js}</script><!--/forge-kit-->\n`;
}
function withKit(html) {
  const clean = html.replace(KIT_RE, '');
  return /<head[^>]*>/i.test(clean) ? clean.replace(/<head[^>]*>/i, (m) => `${m}\n${kitHead()}`) : kitHead() + clean;
}
const withoutKit = (html) => html.replace(KIT_RE, '');

// Rules for every pass that writes the page. The design system lives in public/forge-kit.css
// (gains-cmd "Focus" / shelf-cmd register); the model builds with its classes instead of inventing CSS.
const SYSTEM_PROMPT = `You build small personal web apps for one household. Each app runs on Hostess, a home server.

Answer with ONE complete HTML file: start with <!doctype html>, end with </html>. After </html>, write one short plain sentence saying what you built or changed. Nothing before the doctype.

The page already has the Forge kit loaded: fonts, a design system and helper functions. Never load other scripts, fonts or stylesheets, and never define these helpers yourself.

Helpers. They throw an Error with a readable message on failure: catch it and show err.message.
- await store.get(key, fallback) -> the saved value, or fallback on first launch. Always pass a fallback ([] or {}).
- await store.set(key, value) -> saves any JSON. Keys: letters, numbers, - and _.
- await askAI(prompt, system) -> text from the household's AI. Slow: show a loading state.
- await notify(title, message) -> a notification on the owner's phone.
- await ask(question, value) -> text the user types in a sheet (value is the starting text), or null if cancelled. Use it to edit or rename something, instead of prompt().
- await confirmBox(question) -> true or false from a sheet with Yes / Cancel. Use it before deleting or resetting, instead of confirm().
- dates.today() -> today as 'YYYY-MM-DD' in local time. dates.addDays(day, n), dates.daysBetween(from, to) -> whole days, dates.weekStart(day) -> that week's Monday, dates.monthOf(day) -> 'YYYY-MM', dates.label(day) -> 'Mon, 5 Oct'. Every dates helper takes and returns 'YYYY-MM-DD' strings, never Date objects, and is always called through dates. (dates.weekStart(), not weekStart()). Keep days as these strings and compare them as strings. Never use toISOString for days.

Design system. Build with these classes and add only small CSS for what they lack:
- Layout: <main class="app"> wraps everything. A .topbar holds the .brand (the app name in small capitals) and a .meta (e.g. today's date).
- Type: <h1> is the big title, then <p class="subtitle"> one line of live status. <h2> is a small uppercase section label. .label is a small uppercase label inside a card. .meta is small mono detail text ("3 items · today"). .big is a large card title, .num a huge number.
- Surfaces: .card (soft rounded panel; .card.tight around lists), .stack (vertical spacing), .grid-2 / .grid-3, .stat (a number tile), .divider.
- Buttons: .btn (soft), .btn.btn-primary (the ONE main action: full width, accent colour, may end with <span aria-hidden="true">→</span>), .btn.btn-danger, .btn-link (small text action inside a row), .btn-row (buttons side by side).
- Forms: inputs, selects and textareas are already styled. .field wraps a .label and its input. Tick boxes: <input type="checkbox" class="check">.
- Lists: <ul class="list"> of <li class="row"> holding a .tile (one or two capital letters), a .row-main with a .row-title and a .meta, then its actions. li.row.done greys it out and strikes it through. Also .chips with .chip (.on = selected), .seg (segmented buttons, .on = active), .progress containing <span style="width:40%">, .badge (.ok / .warn).
- States: .empty containing an .empty-title for first launch, .status (and .status.error) for loading and errors, .hidden to hide.
- Colour: set an accent that suits the app with <style>:root { --accent: #hex; }</style>, a deep one such as #2f6fed blue, #0f7b5f green, #b4235a raspberry, #6d3fd8 violet, #c2410c orange or #0e7490 teal. For a dark look put data-theme="dark" on <html>.

Rules:
- Save everything the user enters with store.set (never localStorage) and load it on start, so it is the same on every device.
- When the app tracks something over time, save dated entries ({ id, day: dates.today(), ... }) so history and totals can be worked out.
- Every list the app keeps needs a visible form to add to it. Things you tick off get an <input type="checkbox" class="check"> at the start of their row, not a text button.
- One <script> at the end of <body>. Any function that uses await is declared async. Every element you look up by id must exist in the page.
- Never use prompt(), alert() or confirm(): put choices in the page (a select or .seg) and confirmations inline.
- Plain words: the user is not technical. A short <title> naming the app.

Two small complete examples: a tracker and a tick-off list. Copy how they are wired, how they use the design system and how they are laid out (what the user came to see first, the add form inside or after that card); do not copy their subjects or wording.

Example 1:
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Water Log</title>
<style>:root { --accent: #1677c9; }</style>
</head><body><main class="app">
<div class="topbar"><span class="brand">Water Log</span><span class="meta" id="todayLabel"></span></div>
<h1>Drink up</h1>
<p class="subtitle" id="summary">Loading…</p>
<div class="card">
  <span class="label">Today</span>
  <div class="num" id="total">0</div>
  <div class="meta">ml · goal 2000</div>
  <div class="progress" style="margin:16px 0 20px"><span id="bar" style="width:0%"></span></div>
  <form id="add" class="stack">
    <input id="amount" type="number" min="1" inputmode="numeric" placeholder="How much? (ml)" required>
    <button class="btn btn-primary">Add a glass <span aria-hidden="true">→</span></button>
  </form>
</div>
<h2>Logged today</h2>
<div class="card tight">
  <ul class="list" id="list"></ul>
  <div class="empty" id="empty"><div class="empty-title">Nothing yet</div>Your first glass shows up here.</div>
  <p class="status" id="msg"></p>
</div>
</main><script>
let entries = [];
const GOAL = 2000;
function render() {
  const todays = entries.filter((e) => e.day === dates.today());
  const total = todays.reduce((s, e) => s + e.ml, 0);
  document.getElementById('todayLabel').textContent = dates.label(dates.today());
  document.getElementById('total').textContent = total;
  document.getElementById('bar').style.width = Math.min(100, (total / GOAL) * 100) + '%';
  document.getElementById('summary').textContent = total >= GOAL ? 'Goal reached. Nice work.' : \`\${GOAL - total} ml to go today.\`;
  document.getElementById('list').innerHTML = todays.map((e) => \`
    <li class="row"><span class="tile">\${e.ml >= 500 ? 'L' : 'S'}</span>
      <span class="row-main"><span class="row-title">\${e.ml} ml</span><br><span class="meta">\${e.time}</span></span>
      <button class="btn-link" data-id="\${e.id}">Remove</button></li>\`).join('');
  document.getElementById('empty').classList.toggle('hidden', todays.length > 0);
}
function showError(err) {
  const status = document.getElementById('msg');
  status.className = 'status error';
  status.textContent = err.message;
}
async function save() {
  try { await store.set('entries', entries); } catch (err) { showError(err); }
}
document.getElementById('add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('amount');
  const ml = Number(input.value);
  if (!ml) return;
  entries.push({ id: Date.now(), day: dates.today(), time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), ml });
  input.value = '';
  render();
  await save();
});
// One click handler for the whole page: row buttons are found by their data- attribute, so it keeps
// working whatever the lists are called.
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-id]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  entries = entries.filter((x) => x.id !== id);
  render();
  await save();
});
async function init() {
  try { entries = await store.get('entries', []); render(); } catch (err) { showError(err); }
}
init();
</script></body></html>

Example 2:
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Packing List</title>
<style>:root { --accent: #b4235a; }</style>
</head><body><main class="app">
<div class="topbar"><span class="brand">Packing List</span><span class="meta" id="itemCount"></span></div>
<h1>Beach trip</h1>
<p class="subtitle" id="summary">Loading…</p>
<div class="card">
  <div class="seg" id="filter"><button class="on" data-show="all">All</button><button data-show="left">To pack</button></div>
  <ul class="list" id="list" style="margin-top:8px"></ul>
  <div class="empty hidden" id="empty"><div class="empty-title">Nothing on the list</div>Add the first thing to pack below.</div>
  <hr class="divider">
  <form id="add" class="btn-row">
    <input id="name" placeholder="Add something to pack" required>
    <button class="btn btn-icon" aria-label="Add">+</button>
  </form>
  <p class="status" id="msg"></p>
</div>
</main><script>
let items = [];
let show = 'all';
function render() {
  const left = items.filter((i) => !i.done).length;
  document.getElementById('summary').textContent = items.length ? (left ? \`\${left} of \${items.length} still to pack.\` : 'All packed. Have a great trip.') : 'Start your list.';
  document.getElementById('itemCount').textContent = \`\${items.length} items\`;
  const visible = show === 'left' ? items.filter((i) => !i.done) : items;
  document.getElementById('list').innerHTML = visible.map((i) => \`
    <li class="row\${i.done ? ' done' : ''}">
      <input type="checkbox" class="check" data-id="\${i.id}" \${i.done ? 'checked' : ''} aria-label="Packed">
      <span class="row-main"><span class="row-title">\${i.name}</span><br><span class="meta">added \${dates.label(i.day)}</span></span>
      <button class="btn-link" data-remove="\${i.id}">Remove</button></li>\`).join('');
  document.getElementById('empty').classList.toggle('hidden', visible.length > 0);
}
async function save() {
  try { await store.set('items', items); } catch (err) { showError(err); }
}
function showError(err) {
  const status = document.getElementById('msg');
  status.className = 'status error';
  status.textContent = err.message;
}
document.getElementById('add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('name');
  const name = input.value.trim();
  if (!name) return;
  items.push({ id: Date.now(), name, done: false, day: dates.today() });
  input.value = '';
  render();
  await save();
});
document.addEventListener('click', async (e) => {
  const tick = e.target.closest('[data-id]');
  const remove = e.target.closest('[data-remove]');
  if (tick) { const item = items.find((i) => i.id === Number(tick.dataset.id)); item.done = tick.checked; }
  else if (remove) items = items.filter((i) => i.id !== Number(remove.dataset.remove));
  else return;
  render();
  await save();
});
document.getElementById('filter').addEventListener('click', (e) => {
  const b = e.target.closest('[data-show]');
  if (!b) return;
  show = b.dataset.show;
  document.querySelectorAll('#filter button').forEach((x) => x.classList.toggle('on', x === b));
  render();
});
async function init() {
  try { items = await store.get('items', []); render(); } catch (err) { showError(err); }
}
init();
</script></body></html>`;

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
  "style": {"mood": "a few words", "accent": "#hex that suits what the app is for", "theme": "light or dark"}
}
Give 4 to 6 extras.`;

const STOP = new Set('the and for with that this from your you app apps make build want have will can into using use what when where which who how its are was were but not all any one some like just need needs page site web simple small little track tracker show list search log chart board schedule box local home house family day days each total'.split(' '));

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
function retrieve(prompt, k = 2) {
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
  // Measured (E17): loosely matched notes made builds worse than no notes at all. Common words
  // ("day", "total") match half the vault, so a note gets in only on specific words (in at most 8%
  // of notes): three of them in its text, or a whole word of its title (the request names that note's subject).
  }).filter((d) => {
    if (d.title.startsWith('_')) return false; // index/meta notes match everything
    const specific = d.matched.filter((t) => df[t] <= Math.max(2, docs.length * 0.08));
    const titleWords = d.title.toLowerCase().split(/[^a-z0-9]+/);
    return specific.length >= 3 || q.some((t) => t.length >= 4 && titleWords.includes(t));
  }).sort((a, b) => b.score - a.score).slice(0, k);
  return {
    vault,
    notes: scored.map((d) => ({
      title: d.title,
      path: path.relative(vault, d.file),
      score: Math.round(d.score * 10) / 10,
      matched: d.matched,
      excerpt: d.body.replace(/^---[\s\S]*?---\s*/, '').slice(0, 1200),
    })),
  };
}

function notesBlock(notes) {
  if (!notes.length) return '';
  return `\n\nThe owner's notes that may be relevant (follow any preferences in them; ignore the rest):\n`
    + notes.map((n) => `\n--- ${n.title} ---\n${n.excerpt}`).join('\n');
}

function styleBlock(spec, style) {
  if (style && style.custom) return `Look, as the owner describes it: ${style.custom}. Express it through --accent and data-theme where you can.`;
  const st = spec.style || {};
  return `Look: ${st.mood || 'calm and clear'}. Accent ${st.accent || '#2f6fed'}${st.theme === 'dark' ? ', dark theme (data-theme="dark" on <html>)' : ', light theme'}.`;
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
async function generate({ stage, requests, html, spec, plan, step, style, model, think, fix, seed }, emit, signal) {
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
    body: JSON.stringify({ model: useModel || undefined, messages, stream: true, stream_options: { include_usage: true }, temperature: 0.2, max_tokens: 9000, ...(!think && { reasoning_effort: 'none' }), ...(Number.isInteger(seed) && { seed }) }),
    signal,
  });
  if (!res.ok) throw new Error(`local AI returned HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const decoder = new TextDecoder();
  let buf = '', written = '', checkedAt = 0;
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
      if (delta.content) {
        emit({ type: 'content', text: delta.content });
        written += delta.content;
        // A small model at low temperature can fall into a loop, re-writing the same block until it
        // runs out of room. If the latest stretch already appeared earlier, stop it here.
        if (written.length - checkedAt > 1500) {
          checkedAt = written.length;
          const tail = written.slice(-400);
          if (written.length > 3000 && written.slice(0, -400).includes(tail)) {
            res.body.cancel().catch(() => {});
            throw new Error('The model got stuck repeating itself. Try again, or describe the app a little differently.');
          }
        }
      }
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

module.exports = { generate, previewAi, retrieve, listProjects, getProject, saveProject, deleteProject, withKit, kitHead };
