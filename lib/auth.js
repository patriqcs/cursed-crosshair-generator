'use strict';

const crypto = require('crypto');
const session = require('express-session');
const storage = require('./storage');

const SESSION_SECRET_FILE = '.session-secret';
const ADMIN_CRED_FILE = 'admin-credentials.txt';

function getOrCreateSessionSecret() {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim() !== '') {
    return process.env.SESSION_SECRET;
  }
  const existing = storage.readTextSync(SESSION_SECRET_FILE);
  if (existing && existing.trim() !== '') return existing.trim();

  const generated = crypto.randomBytes(48).toString('hex');
  storage.writeTextSync(SESSION_SECRET_FILE, generated);
  return generated;
}

function getOrCreateAdminPassword() {
  if (process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.trim() !== '') {
    return { password: process.env.ADMIN_PASSWORD, generated: false };
  }
  const existing = storage.readTextSync(ADMIN_CRED_FILE);
  if (existing) {
    const match = existing.match(/PASSWORD:\s*(\S+)/);
    if (match) return { password: match[1], generated: true, persisted: true };
  }

  // 24-char password, base64url style for readability
  const password = crypto.randomBytes(18).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  const user = process.env.ADMIN_USER || 'admin';
  const fileBody = [
    `=== j4nkTTV's Cursed Crosshair Generator — Initial Admin Credentials ===`,
    '',
    `USER: ${user}`,
    `PASSWORD: ${password}`,
    '',
    'Set ADMIN_PASSWORD in your environment to override this generated password.',
    '',
  ].join('\n');
  storage.writeTextSync(ADMIN_CRED_FILE, fileBody);

  // eslint-disable-next-line no-console
  console.log(`=== INITIAL ADMIN PASSWORD: ${password} ===`);
  return { password, generated: true, persisted: false };
}

function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function buildSessionMiddleware(secret) {
  return session({
    name: 'ccg.sid',
    secret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 12, // 12h
    },
  });
}

function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  // Use originalUrl so the check works correctly even when this middleware is
  // mounted via app.use('/api/admin', requireAuth) — req.path is relative there.
  const fullPath = req.originalUrl || req.url || '';
  if (fullPath.startsWith('/api/')) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return res.redirect('/admin/login');
}

module.exports = {
  getOrCreateSessionSecret,
  getOrCreateAdminPassword,
  timingSafeEqualStr,
  buildSessionMiddleware,
  requireAuth,
};
