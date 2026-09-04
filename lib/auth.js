const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const wordlist = require('./wordlist');

const AUTH_PATH = path.join(__dirname, '..', 'auth.json');
const COOKIE_NAME = 'hostess_session';
const SCRYPT_KEYLEN = 64;

function readAuth() {
  if (!fs.existsSync(AUTH_PATH)) return null;
  return JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
}

function writeAuth(data) {
  const tmpPath = `${AUTH_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, AUTH_PATH);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex') };
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function hasAccount() {
  return !!readAuth();
}

function createAccount(username, password) {
  if (hasAccount()) throw new Error('Account already exists');
  if (!username || !password || password.length < 8) {
    throw new Error('Username and an at-least-8-character password are required');
  }
  const { salt, hash } = hashPassword(password);
  writeAuth({ username, salt, hash, sessionSecret: crypto.randomBytes(32).toString('hex') });
}

function verifyLogin(username, password) {
  const auth = readAuth();
  if (!auth || auth.username !== username) return false;
  return verifyPassword(password, auth.salt, auth.hash);
}

function changePassword(currentPassword, newPassword) {
  const auth = readAuth();
  if (!auth) throw new Error('No account exists');
  if (!verifyPassword(currentPassword, auth.salt, auth.hash)) throw new Error('Current password is wrong');
  if (!newPassword || newPassword.length < 8) throw new Error('New password must be at least 8 characters');
  const { salt, hash } = hashPassword(newPassword);
  // Rotating sessionSecret invalidates every other logged-in session/device,
  // same as changing a password anywhere else.
  writeAuth({ ...auth, salt, hash, sessionSecret: crypto.randomBytes(32).toString('hex') });
}

function generatePassphrase(wordCount = 8) {
  const words = [];
  for (let i = 0; i < wordCount; i++) words.push(wordlist[crypto.randomInt(wordlist.length)]);
  return words.join('-');
}

function sign(secret, value) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function issueToken() {
  const auth = readAuth();
  const payload = String(Date.now());
  return `${payload}.${sign(auth.sessionSecret, payload)}`;
}

function verifyToken(token) {
  const auth = readAuth();
  if (!auth || !token) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = sign(auth.sessionSecret, payload);
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function setSessionCookie(res) {
  res.cookie(COOKIE_NAME, issueToken(), { httpOnly: true, sameSite: 'lax', maxAge: 90 * 24 * 60 * 60 * 1000 });
}

function isLoggedIn(req) {
  return verifyToken(readCookie(req, COOKIE_NAME));
}

// Gates every /api route. No more loopback/tunnel distinction — login is
// required regardless of how the dashboard is being reached.
function middleware(req, res, next) {
  if (!hasAccount()) return res.status(401).json({ error: 'setup required', needsSetup: true });
  if (isLoggedIn(req)) return next();
  res.status(401).json({ error: 'login required', needsLogin: true });
}

module.exports = {
  hasAccount, createAccount, verifyLogin, changePassword, generatePassphrase,
  setSessionCookie, isLoggedIn, middleware, COOKIE_NAME,
};
