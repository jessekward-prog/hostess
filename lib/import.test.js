const assert = require('assert');
const { zipSync, strToU8 } = require('fflate');
const { safeRel, filesFromZip, filesFromText, filesFromFrames } = require('./import');

for (const bad of ['../x', '/etc/passwd', 'a/../../x', 'C:/x', 'a\\..\\..\\x', 'dir/']) assert.throws(() => safeRel(bad), bad);
assert.strictEqual(safeRel('public/index.html'), 'public/index.html');

const z = Buffer.from(zipSync({ 'app/app.yaml': strToU8('name: x'), '__MACOSX/app/._a': strToU8('j'), 'app/public/': new Uint8Array(0) }));
assert.deepStrictEqual(filesFromZip(z).map((f) => f[0]), ['app/app.yaml']);
assert.throws(() => filesFromZip(Buffer.from(zipSync({ '../evil': strToU8('x') }))), /Unsafe/);

const t = filesFromText('Here you go\n### `app.yaml`\n```yaml\nname: x\n```\n\n### public/a.md\n````md\n```js\n1\n```\n````\nDone');
assert.deepStrictEqual(t.map((f) => f[0]), ['app.yaml', 'public/a.md']);
assert.strictEqual(t[1][1].toString(), '```js\n1\n```\n');
assert.throws(() => filesFromText('no files here'), /No files/);
const frame = (p, d) => Buffer.concat([Buffer.from(JSON.stringify({ path: p, size: d.length }) + '\n'), d]);
const fr = filesFromFrames(Buffer.concat([frame('app/app.yaml', Buffer.from('name: x\nline')), frame('app/node_modules/a.js', Buffer.from('x')), frame('app/bin', Buffer.from([0, 10, 255]))]));
assert.deepStrictEqual(fr.map((f) => f[0]), ['app/app.yaml', 'app/bin']);
assert.deepStrictEqual([...fr[1][1]], [0, 10, 255]);
assert.throws(() => filesFromFrames(frame('../x', Buffer.from('a'))), /Unsafe/);
assert.throws(() => filesFromFrames(Buffer.from('{"path":"a","size":99}\nshort')), /Corrupt/);
console.log('import.test ok');
