const crypto = require('crypto');

const COOKIE_NAME = 'hostess_session';

let pin = null;
let sessionSecret = crypto.randomBytes(32).toString('hex');

// cloudflared adds this only when it's proxying tunnel traffic; a request that
// hits Express directly (dashboard opened at http://localhost:5300) never
// carries it. That's the actual trust boundary here — remoteAddress isn't
// usable because cloudflared itself connects to Express from 127.0.0.1 too.
function isTunneled(req) {
  return Boolean(req.headers['cf-connecting-ip']);
}

function rotatePin() {
  pin = String(crypto.randomInt(100000, 999999));
  sessionSecret = crypto.randomBytes(32).toString('hex'); // invalidates any prior session cookie
  return pin;
}

function clearPin() {
  pin = null;
  sessionSecret = crypto.randomBytes(32).toString('hex');
}

function getPin() {
  return pin;
}

function sign(value) {
  return crypto.createHmac('sha256', sessionSecret).update(value).digest('base64url');
}

function issueToken() {
  const payload = String(Date.now());
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (!token || !pin) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = sign(payload);
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

function verifyPin(req, res, candidate) {
  if (!pin || candidate !== pin) return false;
  const token = issueToken();
  res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: 'lax', maxAge: 24 * 60 * 60 * 1000 });
  return true;
}

// Gates /api routes. Direct local requests always pass. Requests arriving
// through the quick tunnel need a valid session cookie from /api/auth/verify.
function middleware(req, res, next) {
  if (!isTunneled(req)) return next();
  const token = readCookie(req, COOKIE_NAME);
  if (verifyToken(token)) return next();
  res.status(401).json({ error: 'pin required', needsPin: true });
}

module.exports = { middleware, rotatePin, clearPin, getPin, verifyPin, isTunneled, COOKIE_NAME };
