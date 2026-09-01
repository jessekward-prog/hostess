const fs = require('fs');
const path = require('path');

const SETTINGS_PATH = path.join(__dirname, '..', 'settings.json');

function readAll() {
  if (!fs.existsSync(SETTINGS_PATH)) return {};
  return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
}

function writeAll(data) {
  const tmpPath = `${SETTINGS_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, SETTINGS_PATH);
}

function get(key) {
  return readAll()[key];
}

function set(key, value) {
  const all = readAll();
  if (value === undefined || value === '') delete all[key];
  else all[key] = value;
  writeAll(all);
}

module.exports = { get, set };
