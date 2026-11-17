const fs = require('fs');
const path = require('path');
const { unzipSync } = require('fflate');
const manifest = require('./manifest');
const engine = require('./engine');

// Uploaded zips and pasted AI replies land here, one folder per app. It is the app's repoSource,
// so the dashboard's Redeploy re-reads a folder that still exists (a temp upload would be gone).
const IMPORTS_DIR = path.join(__dirname, '..', 'imports');
const MAX_BYTES = 200e6; // unzipped total; the upload itself is capped in server.js
const SKIP = /(^|\/)(__MACOSX|\.git|\.DS_Store|node_modules)(\/|$)/;

// Trust boundary: names come from a stranger's zip or an AI's text. Reject anything that could
// land outside the folder (zip-slip) rather than sanitising it.
function safeRel(p) {
  const rel = path.posix.normalize(String(p).replace(/\\/g, '/'));
  if (!rel || rel.startsWith('/') || /^[a-zA-Z]:/.test(rel) || rel === '..' || rel.startsWith('../') || rel.endsWith('/') || rel.includes('\0')) {
    throw new Error(`Unsafe path in upload: ${p}`);
  }
  return rel;
}

function filesFromZip(buf) {
  let total = 0;
  const entries = unzipSync(new Uint8Array(buf), {
    filter: (f) => {
      if (f.name.endsWith('/') || SKIP.test(f.name)) return false;
      total += f.originalSize;
      if (total > MAX_BYTES) throw new Error('Zip is too large when unpacked');
      return true;
    },
  });
  return Object.entries(entries).map(([name, data]) => [safeRel(name), Buffer.from(data)]);
}

// Folder upload from the browser: for each file, a JSON header line {path,size}, then size raw bytes.
function filesFromFrames(buf) {
  const out = [];
  let pos = 0;
  let total = 0;
  while (pos < buf.length) {
    const nl = buf.indexOf(10, pos);
    if (nl < 0) throw new Error('Corrupt folder upload');
    const { path: p, size } = JSON.parse(buf.toString('utf8', pos, nl));
    if (!Number.isInteger(size) || size < 0 || nl + 1 + size > buf.length) throw new Error('Corrupt folder upload');
    total += size;
    if (total > MAX_BYTES) throw new Error('Folder is too large');
    const rel = safeRel(p);
    if (!SKIP.test(rel)) out.push([rel, buf.subarray(nl + 1, nl + 1 + size)]);
    pos = nl + 1 + size;
  }
  if (!out.length) throw new Error('That folder is empty');
  return out;
}

// "### path/to/file" (optionally in backticks or bold) followed by one fenced block, the layout
// the starter prompt asks chat AIs for. \2 matches the closing fence to the opening one, so a
// ```` fence can hold a markdown file that itself contains ``` blocks.
const BLOCK_RE = /^#{1,6}[ \t]*[`*]*([\w.\/@ -]+?)[`*]*[ \t]*\r?\n+(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\r?\n\2[ \t]*$/gm;
function filesFromText(text) {
  const out = [];
  for (const m of text.matchAll(BLOCK_RE)) out.push([safeRel(m[1].trim()), Buffer.from(m[3] + '\n')]);
  if (!out.length) throw new Error('No files found. Each file needs a "### path/to/file" heading followed by a code block.');
  return out;
}

// Zips often wrap everything in one folder (macOS, GitHub, "zip the folder"): find the app root.
function appRoot(dir) {
  if (fs.existsSync(path.join(dir, 'app.yaml'))) return dir;
  const subs = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
  if (subs.length === 1 && fs.existsSync(path.join(dir, subs[0].name, 'app.yaml'))) return path.join(dir, subs[0].name);
  throw new Error('No app.yaml found at the top of the upload. Zip the app folder itself, not a folder containing several.');
}

// files: [[relativePath, Buffer]]. Validates, saves under imports/<name>/, deploys from there.
async function importFiles(files, log = () => {}) {
  fs.mkdirSync(IMPORTS_DIR, { recursive: true });
  const tmp = path.join(IMPORTS_DIR, `_tmp-${Date.now()}`);
  try {
    for (const [rel, data] of files) {
      const dest = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, data);
    }
    const root = appRoot(tmp);
    const { name } = manifest.load(root);
    const final = path.join(IMPORTS_DIR, name);
    const updated = fs.existsSync(final);
    fs.rmSync(final, { recursive: true, force: true });
    fs.renameSync(root, final);
    log(`${updated ? 'Updating' : 'Importing'} "${name}" from upload`);
    const record = await engine.deployApp(final, log);
    return { ...record, updated };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { importFiles, filesFromZip, filesFromText, filesFromFrames, safeRel };
