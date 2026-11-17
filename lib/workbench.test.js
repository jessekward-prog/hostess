// Run: node lib/workbench.test.js (no Docker or LM Studio needed)
// Stand-in OpenAI-compatible server: streams a reply with a <think> block split across chunks.
const http = require('http');
const fs = require('fs'), os = require('os'), path = require('path');
const H = __dirname + '/';
const app = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-test-'));
fs.writeFileSync(path.join(app, 'app.yaml'), 'name: wb-test\nport: 3000\n');
fs.writeFileSync(path.join(app, 'Dockerfile'), 'FROM scratch\n');
fs.mkdirSync(path.join(app, 'src')); fs.writeFileSync(path.join(app, 'src', 'a.js'), '');
fs.mkdirSync(path.join(app, 'node_modules')); fs.writeFileSync(path.join(app, 'node_modules', 'x.js'), '');
let got;
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => b += d); req.on('end', async () => {
    got = JSON.parse(b);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const piece of ['<thi', 'nk>planning the', ' prompt</th', 'ink>\n\nGoal: tidy', ' the cards.\nDone when: both widths checked.']) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
      await new Promise((r) => setTimeout(r, 30));
    }
    res.end('data: [DONE]\n\n');
  });
}).listen(0, async () => {
  const docker = require(H + 'docker'); docker.stopAndRemove = docker.buildImage = docker.runContainer = async () => {}; docker.findFreePort = async () => 5499;
  require(H + 'settings').set = () => {};
  require(H + 'guard').lmConfig = () => ({ url: `http://127.0.0.1:${srv.address().port}`, apiKey: 'x', model: '' });
  const wb = require(H + 'workbench');
  await wb.start(app).catch(() => {}); // sets state.dir; docker stubbed
  let out = '';
  await wb.refinePrompt('cards cramped on phones', (t) => (out += t), new AbortController().signal);
  const assert = require('assert');
  assert.strictEqual(out, 'Goal: tidy the cards.\nDone when: both widths checked.');
  const user = got.messages[1].content;
  assert(got.stream === true && got.max_tokens === undefined);
  assert(/ticker-tape or marquee/.test(got.messages[0].content), 'system prompt translates everyday words into technical terms');
  assert(/Match the length to the request/.test(got.messages[0].content) && !/Unclear:/.test(got.messages[0].content), 'system prompt keeps short requests short, blanks instead of an Unclear section');
  assert(user.includes('Folder: ' + app) && user.includes('name: wb-test') && user.includes('src/') && !user.includes('node_modules'));
  console.log('workbench refine: all checks passed');
  await wb.stop(); fs.rmSync(app, { recursive: true }); process.exit(0);
});
