'use strict';

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const fs = require('fs');
const storage = require('./lib/storage');
const auth = require('./lib/auth');
const turnstile = require('./lib/turnstile');
const state = require('./lib/state');
const cfgExport = require('./lib/cfg-export');
const defaults = require('./lib/defaults');
const validation = require('./lib/validation');

const PORT = parseInt(process.env.PORT || '3000', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');

// Real-IP key for rate limiters (Cloudflare Tunnel sets CF-Connecting-IP)
function realIpKey(req) {
  const cf = req.get('CF-Connecting-IP');
  if (cf && cf.trim() !== '') return cf.trim();
  return req.ip || 'unknown';
}

// Initialise data dir + seed early so first-run errors surface at boot
storage.ensureDirSync(storage.dataDir());
state.ensureSeed();

// Resolve admin credentials + session secret
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const adminCred = auth.getOrCreateAdminPassword();
const ADMIN_PASSWORD = adminCred.password;

if (adminCred.generated) {
  // eslint-disable-next-line no-console
  console.log(`[INFO] Admin user: ${ADMIN_USER}`);
  // eslint-disable-next-line no-console
  console.log(`[INFO] Admin credentials file: ${path.join(storage.dataDir(), 'admin-credentials.txt')}`);
}

const SESSION_SECRET = auth.getOrCreateSessionSecret();

if (!turnstile.getSiteKey() || !process.env.TURNSTILE_SECRET_KEY) {
  // eslint-disable-next-line no-console
  console.warn('[WARN] Turnstile keys not configured — submissions captcha disabled');
}

// Middleware
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));
app.use(cookieParser());
app.use(auth.buildSessionMiddleware(SESSION_SECRET));

// Static assets (public/ holds both public + admin SPA shells)
app.use('/static', express.static(PUBLIC_DIR, {
  fallthrough: true,
  maxAge: '1h',
  etag: true,
}));

// Rate limiters
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: realIpKey,
  message: { error: 'too_many_requests' },
});

const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: realIpKey,
  message: { error: 'too_many_requests' },
});

// =========================================================================
// PUBLIC ROUTES
// =========================================================================

app.get('/', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/api/public/config', (_req, res) => {
  res.json({
    turnstileSiteKey: turnstile.getSiteKey() || null,
    captchaEnabled: turnstile.isConfigured(),
  });
});

app.get('/api/public/defaults', (_req, res) => {
  res.json({
    params: defaults.clone(defaults.STARTER_PRESET_PARAMS),
  });
});

app.post('/api/submissions', submitLimiter, async (req, res) => {
  const { cfTurnstileToken, ...rest } = req.body || {};

  // Verify captcha first (Section 5)
  const verifyResult = await turnstile.verify(cfTurnstileToken, realIpKey(req));
  if (!verifyResult.ok) {
    const status = verifyResult.reason === 'captcha_unavailable' ? 503 : 400;
    return res.status(status).json({ error: verifyResult.reason });
  }

  const validated = state.validateSubmissionInput(rest);
  if (!validated) {
    return res.status(400).json({ error: 'invalid_input' });
  }

  const data = state.readSubmissions();
  const id = state.newId();
  const submission = {
    id,
    submitterName: validated.submitterName,
    presetName: validated.presetName,
    params: validated.params,
    submittedAt: state.nowIso(),
    status: 'pending',
  };
  data.submissions.push(submission);
  state.writeSubmissions(data);

  res.json({ ok: true, id });
});

// =========================================================================
// ADMIN AUTH
// =========================================================================

app.get('/admin/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/admin');
  res.sendFile(path.join(PUBLIC_DIR, 'login.html'));
});

app.post('/admin/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  const userOk = auth.timingSafeEqualStr(String(username || ''), ADMIN_USER);
  const passOk = auth.timingSafeEqualStr(String(password || ''), ADMIN_PASSWORD);
  if (userOk && passOk) {
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'session_error' });
      req.session.user = ADMIN_USER;
      req.session.save(() => res.json({ ok: true }));
    });
    return;
  }
  res.status(401).json({ error: 'invalid_credentials' });
});

app.post('/admin/logout', (req, res) => {
  if (!req.session) return res.json({ ok: true });
  req.session.destroy(() => {
    res.clearCookie('ccg.sid');
    res.json({ ok: true });
  });
});

// Protect admin routes from here on
app.get('/admin', auth.requireAuth, (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});

app.use('/api/admin', auth.requireAuth);
app.use('/admin', auth.requireAuth);

// =========================================================================
// ADMIN STATE (presets / restore / keys)
// =========================================================================

app.get('/api/admin/state', (_req, res) => {
  res.json(state.readState());
});

app.put('/api/admin/state', (req, res) => {
  const incoming = req.body || {};
  const current = state.readState();

  let next = current;

  if (Array.isArray(incoming.presets)) {
    const validatedPresets = [];
    for (const p of incoming.presets) {
      const valPreset = state.validatePresetInput(p);
      if (!valPreset) return res.status(400).json({ error: 'invalid_preset' });
      const id = typeof p.id === 'string' && p.id.length ? p.id : state.newId();
      const preset = { id, name: valPreset.name, params: valPreset.params };
      if (typeof p.submittedBy === 'string' && p.submittedBy.trim() !== '') {
        const sn = validation.sanitizePresetName(p.submittedBy.trim()) || p.submittedBy.trim().slice(0, 60);
        preset.submittedBy = sn;
      }
      validatedPresets.push(preset);
    }
    next = { ...next, presets: validatedPresets };
  }

  if (incoming.restore) {
    const valRestore = state.validateRestoreInput(incoming.restore);
    if (!valRestore) return res.status(400).json({ error: 'invalid_restore' });
    next = { ...next, restore: valRestore };
  }

  if (incoming.keys) {
    const valKeys = state.validateKeysInput(incoming.keys);
    if (!valKeys) return res.status(400).json({ error: 'invalid_keys' });
    next = { ...next, keys: valKeys };
  }

  state.writeState(next);
  res.json(next);
});

app.post('/api/admin/presets', (req, res) => {
  const valPreset = state.validatePresetInput(req.body);
  if (!valPreset) return res.status(400).json({ error: 'invalid_preset' });
  const cur = state.readState();
  const preset = { id: state.newId(), name: valPreset.name, params: valPreset.params };
  const next = { ...cur, presets: [...cur.presets, preset] };
  state.writeState(next);
  res.json(preset);
});

app.put('/api/admin/presets/:id', (req, res) => {
  const cur = state.readState();
  const idx = cur.presets.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not_found' });
  const valPreset = state.validatePresetInput(req.body);
  if (!valPreset) return res.status(400).json({ error: 'invalid_preset' });
  const previous = cur.presets[idx];
  const updated = { ...previous, name: valPreset.name, params: valPreset.params };
  const presets = cur.presets.map((p, i) => (i === idx ? updated : p));
  state.writeState({ ...cur, presets });
  res.json(updated);
});

app.delete('/api/admin/presets/:id', (req, res) => {
  const cur = state.readState();
  const idx = cur.presets.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not_found' });
  const presets = cur.presets.filter((_, i) => i !== idx);
  state.writeState({ ...cur, presets });
  res.json({ ok: true });
});

app.post('/api/admin/presets/:id/move', (req, res) => {
  const direction = req.body && req.body.direction;
  if (direction !== 'up' && direction !== 'down') {
    return res.status(400).json({ error: 'invalid_direction' });
  }
  const cur = state.readState();
  const idx = cur.presets.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not_found' });
  const target = direction === 'up' ? idx - 1 : idx + 1;
  if (target < 0 || target >= cur.presets.length) return res.json(cur);
  const presets = [...cur.presets];
  const [moved] = presets.splice(idx, 1);
  presets.splice(target, 0, moved);
  state.writeState({ ...cur, presets });
  res.json({ ok: true });
});

// =========================================================================
// ADMIN SUBMISSIONS
// =========================================================================

app.get('/api/admin/submissions', (req, res) => {
  const { status: statusFilter } = req.query;
  const data = state.readSubmissions();
  let list = data.submissions;
  if (statusFilter && statusFilter !== 'all') {
    list = list.filter((s) => s.status === statusFilter);
  }
  // newest first
  list = [...list].sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));
  res.json({ submissions: list });
});

app.put('/api/admin/submissions/:id', (req, res) => {
  const data = state.readSubmissions();
  const idx = data.submissions.findIndex((s) => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not_found' });

  const incoming = req.body || {};
  const presetName = validation.sanitizePresetName(incoming.presetName);
  if (!presetName) return res.status(400).json({ error: 'invalid_preset_name' });
  const params = validation.validateParams(incoming.params);
  if (!params) return res.status(400).json({ error: 'invalid_params' });

  const updated = { ...data.submissions[idx], presetName, params };
  const submissions = data.submissions.map((s, i) => (i === idx ? updated : s));
  state.writeSubmissions({ ...data, submissions });
  res.json(updated);
});

app.post('/api/admin/submissions/:id/approve', (req, res) => {
  const data = state.readSubmissions();
  const idx = data.submissions.findIndex((s) => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not_found' });

  const sub = data.submissions[idx];
  const override = req.body || {};
  const presetName = override.presetName
    ? validation.sanitizePresetName(override.presetName)
    : sub.presetName;
  if (!presetName) return res.status(400).json({ error: 'invalid_preset_name' });
  const params = override.params ? validation.validateParams(override.params) : sub.params;
  if (!params) return res.status(400).json({ error: 'invalid_params' });

  const cur = state.readState();
  const newPreset = {
    id: state.newId(),
    name: presetName,
    params,
    submittedBy: sub.submitterName,
  };
  state.writeState({ ...cur, presets: [...cur.presets, newPreset] });

  const updatedSub = { ...sub, status: 'approved', presetName, params };
  const submissions = data.submissions.map((s, i) => (i === idx ? updatedSub : s));
  state.writeSubmissions({ ...data, submissions });

  res.json({ ok: true, preset: newPreset });
});

app.post('/api/admin/submissions/:id/reject', (req, res) => {
  const data = state.readSubmissions();
  const idx = data.submissions.findIndex((s) => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not_found' });
  const updated = { ...data.submissions[idx], status: 'rejected' };
  const submissions = data.submissions.map((s, i) => (i === idx ? updated : s));
  state.writeSubmissions({ ...data, submissions });
  res.json(updated);
});

app.delete('/api/admin/submissions/:id', (req, res) => {
  const data = state.readSubmissions();
  const idx = data.submissions.findIndex((s) => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'not_found' });
  const submissions = data.submissions.filter((_, i) => i !== idx);
  state.writeSubmissions({ ...data, submissions });
  res.json({ ok: true });
});

app.post('/api/admin/submissions/cleanup', (_req, res) => {
  const data = state.readSubmissions();
  const submissions = data.submissions.filter((s) => s.status === 'pending');
  state.writeSubmissions({ ...data, submissions });
  res.json({ ok: true, kept: submissions.length });
});

// =========================================================================
// EXPORT .cfg
// =========================================================================

app.get('/api/admin/export', (_req, res) => {
  const cur = state.readState();
  const cfg = cfgExport.buildCfg(cur);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="cc.cfg"');
  res.send(cfg);
});

// =========================================================================
// 404 + error handler
// =========================================================================

app.use((req, res, _next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'not_found' });
  }
  res.status(404).send('Not found');
});

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  // eslint-disable-next-line no-console
  console.error('[ERR]', err);
  res.status(500).json({ error: 'internal_error' });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[INFO] j4nkTTV's Cursed Crosshair Generator listening on :${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`[INFO] Public page:  http://localhost:${PORT}/`);
  // eslint-disable-next-line no-console
  console.log(`[INFO] Admin login:  http://localhost:${PORT}/admin/login`);
});
