'use strict';

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

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
// Hinter genau EINEM Proxy (Cloudflare Tunnel / cloudflared) -> 1 statt 'true',
// damit nicht beliebige X-Forwarded-For-Hops vertraut werden. Per TRUST_PROXY
// überschreibbar. WICHTIG: Der Container-Port darf NUR über den Tunnel erreichbar
// sein — sonst kann CF-Connecting-IP gespooft und das Rate-Limit umgangen werden.
const TRUST_PROXY = process.env.TRUST_PROXY;
app.set(
  'trust proxy',
  TRUST_PROXY != null && TRUST_PROXY !== ''
    ? (/^\d+$/.test(TRUST_PROXY) ? parseInt(TRUST_PROXY, 10) : TRUST_PROXY)
    : 1,
);
app.disable('x-powered-by');

// Harte Obergrenze für offene Submissions (DoS-Backstop gegen unbegrenztes
// Dateiwachstum, unabhängig vom Per-IP-Limit).
const MAX_PENDING_SUBMISSIONS = parseInt(process.env.MAX_PENDING_SUBMISSIONS || '500', 10);

// Real-IP key for rate limiters (Cloudflare Tunnel sets CF-Connecting-IP)
// IPv6 wird auf das /64-Praefix normalisiert: ein Consumer-Anschluss hat ein
// ganzes /64 und koennte sonst pro Adresse ein frisches Limit bekommen.
function realIpKey(req) {
  const cf = req.get('CF-Connecting-IP');
  const ip = cf && cf.trim() !== '' ? cf.trim() : (req.ip || 'unknown');
  return ip.includes(':') ? ipKeyGenerator(ip, 64) : ip;
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

// Zweite Bremse fuer den Login unabhaengig von der Client-IP: begrenzt
// Password-Spraying ueber viele Adressen (z. B. ein rotierendes IPv6-/64 oder
// ein Botnetz) auf 30 Versuche je 15 Minuten insgesamt.
const loginGlobalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: () => 'global',
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

app.get('/favicon.ico', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'img', 'favicon.png'));
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
  const pending = data.submissions.reduce((acc, s) => acc + (s.status === 'pending' ? 1 : 0), 0);
  if (pending >= MAX_PENDING_SUBMISSIONS) {
    return res.status(429).json({ error: 'submission_queue_full' });
  }
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

app.post('/admin/login', loginLimiter, loginGlobalLimiter, (req, res) => {
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

// Admin-Antworten nie cachen (Back/bfcache nach Logout, gemeinsame Browser).
app.use(['/api/admin', '/admin'], (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
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
        // Nur den sanierten Wert übernehmen; bei unzulässigen Zeichen (")/(;)/(<>)
        // verwerfen statt den Rohwert durchzulassen.
        const sn = validation.sanitizePresetName(p.submittedBy.trim());
        if (sn) preset.submittedBy = sn;
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
  // Client-Fehler des Body-Parsers (ungueltiges JSON, zu grosser Body) sind 4xx
  // und werden ohne Request-Body geloggt - vorher landete jeder Muell-Body
  // als 500 samt Inhalt im Log (Log-Flooding/-Injection ohne Login).
  const status = Number.isInteger(err && err.status) ? err.status : 500;
  if (status >= 400 && status < 500) {
    return res.status(status).json({ error: 'bad_request' });
  }
  // eslint-disable-next-line no-console
  console.error('[ERR]', err && err.stack ? err.stack : String(err));
  res.status(500).json({ error: 'internal_error' });
});

const server = app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[INFO] j4nkTTV's Cursed Crosshair Generator listening on :${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`[INFO] Public page:  http://localhost:${PORT}/`);
  // eslint-disable-next-line no-console
  console.log(`[INFO] Admin login:  http://localhost:${PORT}/admin/login`);
});

// Graceful Shutdown: node ist PID 1 im Container und hat keinen Default-
// SIGTERM-Handler; ohne diesen Block wartet docker stop 10 s und killt.
function shutdown(signal) {
  // eslint-disable-next-line no-console
  console.log(`[INFO] ${signal} empfangen, beende ...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
