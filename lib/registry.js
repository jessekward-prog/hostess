const fs = require('fs');
const path = require('path');

const REGISTRY_PATH = path.join(__dirname, '..', 'registry.json');

function readAll() {
  if (!fs.existsSync(REGISTRY_PATH)) return {};
  return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
}

function writeAll(data) {
  const tmpPath = `${REGISTRY_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, REGISTRY_PATH);
}

function get(name) {
  return readAll()[name] || null;
}

function upsert(name, fields) {
  const all = readAll();
  all[name] = { ...all[name], ...fields, name, updatedAt: new Date().toISOString() };
  if (!all[name].createdAt) all[name].createdAt = all[name].updatedAt;
  writeAll(all);
  return all[name];
}

function remove(name) {
  const all = readAll();
  delete all[name];
  writeAll(all);
}

module.exports = { readAll, get, upsert, remove };
