#!/usr/bin/env node
'use strict';

// CS2 Crosshair Debug CLI
// =======================
//
// Generates CS2 cfgs with the current presets bound to F1-F8 (CS2 crosshair
// system since the 2026-09-22 update, 24 cvars as of the 2026-09-30 update, see
// public/js/cvars.js), then watches the CS2 screenshots folder and produces a
// compare HTML page (app preview vs in-game screenshot, side by side).
//
// Subcommands:
//   prepare     write cursed_debug.cfg + per-preset cfgs into CS2's cfg dir
//   launch      launch CS2 via Steam URL (opens Steam, you must press Play)
//   watch       poll the CS2 screenshots dir, copy new shots into data/debug/
//   compare     generate data/debug/compare.html and serve it locally
//   all         prepare + launch + watch (Ctrl+C to stop) + compare
//   detect      print detected paths and exit
//   clean       remove generated cfgs and copied screenshots
//
// VAC-safe: only writes cfg files and starts CS2 via Steam URL — no input
// injection, no memory access, no DLL injection. Screenshots are taken by
// CS2's built-in `screenshot` console command (bound to F11 by default).
//
// Compare page: the page uses the REAL renderer of the running app
// (public/js/preview.js, loaded as an ES module — shader port + in-game
// geometry, rendered in game pixels). Because /static on the app sends no CORS
// headers, `compare` starts a small local HTTP server that serves data/debug/
// and proxies /static/* to --app-url, so the module import is same-origin.
// There are no scale/aspect/stretch controls any more: the renderer works in
// game pixels, so take screenshots with the console command `screenshot`
// (real render buffer) or as PNG at native resolution and compare 1:1.
//
// Pixel-exact comparison (numeric, not by eye) lives in three separate tools:
//   1. node tools/calib-codes.mjs          -> data/calibration-v3/codes.{md,json}
//      Generates the calibration share codes (fixed test cases, magenta, 1920x1080).
//      Default set v3 = features of the 2026-09-30 update (Static Quadrant, outline
//      color, thickness 32, negative gap); `--set v2` = the original 16 cases.
//   2. Import each code in CS2 (Settings -> Crosshair -> Share Code), stand
//      still with the knife in front of the sky / a plain wall and take a PNG
//      screenshot at native 1920x1080; save it as data/calibration-v3/shots/NN.png
//      (NN = case number from codes.md, e.g. 01.png).
//   3. node tools/calib-expected.mjs data/calibration-v3 [W H]
//      Renders the expected pixels (buildShapes + shadePixel, premultiplied,
//      linear light) around the screen centre -> expected/NN.f32 + meta.json.
//   4. python3 tools/calib-compare.py data/calibration-v3 [outdir]
//      Composites expected over the background estimated from the crop edge
//      (game blend model: SRC_ALPHA/ONE_MINUS_SRC_ALPHA in linear light on an
//      sRGB framebuffer), counts missing/extra/wrong pixels, writes diff images
//      (red = missing, yellow = extra, cyan = wrong colour) + report.json.
//   data/ is git-ignored; needs Python 3 with numpy + Pillow for step 4.
//
// Usage:
//   node tools/cs2-debug.js <subcommand> [options]
//
// Options:
//   --app-url URL        URL of the running app (default http://localhost:3000)
//   --admin-user USER    Admin user for fetching state (default $ADMIN_USER or "admin")
//   --admin-pass PASS    Admin password (default $ADMIN_PASSWORD)
//   --steam PATH         Override Steam install path
//   --cfg-dir PATH       Override CS2 cfg dir
//   --shots-dir PATH     Override CS2 screenshots dir
//   --port N             Port of the local compare server (default 3777)
//
// Requires Node >= 22.12 (lib/cvars.js loads the shared browser module via require(esm)).

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { execFileSync, spawn } = require('child_process');

// Gemeinsames Cvar-Modell und Zahlenformat der App wiederverwenden — nichts duplizieren.
const { CVAR_KEYS } = require('../lib/cvars.js');
const { _internal: cfgExport } = require('../lib/cfg-export.js');
const { fmtNum } = cfgExport;

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_APP_URL = 'http://localhost:3000';
const DEFAULT_COMPARE_PORT = 3777;
const APP_DEBUG_DIR = path.join(PROJECT_ROOT, 'data', 'debug');
const APP_SCREENSHOTS_DIR = path.join(APP_DEBUG_DIR, 'screenshots');
const STATE_FILE = path.join(APP_DEBUG_DIR, 'state.json');

// -------------------------------------------------------------------------
// argv parsing
// -------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = (argv[i + 1] && !argv[i + 1].startsWith('--')) ? argv[++i] : true;
      args[key] = val;
    } else {
      args._.push(a);
    }
  }
  return args;
}

// -------------------------------------------------------------------------
// Steam detection
// -------------------------------------------------------------------------
function detectSteamPath(override) {
  if (override) return override;

  // 1) Windows registry
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('reg', [
        'query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath',
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const m = out.match(/SteamPath\s+REG_SZ\s+(.+)/i);
      if (m) {
        const p = m[1].trim().replace(/\//g, '\\');
        if (fs.existsSync(p)) return p;
      }
    } catch (_e) { /* not installed */ }
  }

  // 2) Common paths
  const candidates = [
    process.env.STEAM_PATH,
    process.platform === 'win32' && 'C:\\Program Files (x86)\\Steam',
    process.platform === 'win32' && 'C:\\Program Files\\Steam',
    process.platform === 'darwin' && path.join(os.homedir(), 'Library/Application Support/Steam'),
    process.platform === 'linux' && path.join(os.homedir(), '.steam/steam'),
    process.platform === 'linux' && path.join(os.homedir(), '.local/share/Steam'),
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

function detectCs2Paths(steamPath, override = {}) {
  const cs2Dir = path.join(
    steamPath,
    'steamapps', 'common', 'Counter-Strike Global Offensive', 'game', 'csgo',
  );
  return {
    cs2Dir,
    cfgDir: override.cfgDir || path.join(cs2Dir, 'cfg'),
    shotsDir: override.shotsDir || path.join(cs2Dir, 'screenshots'),
  };
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// -------------------------------------------------------------------------
// HTTP helper for talking to the running app
// -------------------------------------------------------------------------
function http_request(method, urlStr, { headers = {}, body, cookieJar } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = http.request({
      hostname: u.hostname,
      port: u.port || 80,
      path: u.pathname + u.search,
      method,
      headers: {
        ...headers,
        ...(cookieJar && cookieJar.cookie ? { Cookie: cookieJar.cookie } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks).toString('utf8');
        let data = null;
        if (buf) { try { data = JSON.parse(buf); } catch (_e) { data = buf; } }
        // capture session cookie
        const setCookie = res.headers['set-cookie'];
        if (setCookie && cookieJar) {
          const c = setCookie.map((s) => s.split(';')[0]).join('; ');
          cookieJar.cookie = cookieJar.cookie ? `${cookieJar.cookie}; ${c}` : c;
        }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
        else reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode, data }));
      });
    });
    req.on('error', reject);
    if (body !== undefined) {
      req.setHeader('Content-Type', 'application/json');
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function fetchAppState({ appUrl, adminUser, adminPass }) {
  const cookieJar = {};
  await http_request('POST', `${appUrl}/admin/login`, {
    body: { username: adminUser, password: adminPass },
    cookieJar,
  });
  const state = await http_request('GET', `${appUrl}/api/admin/state`, { cookieJar });
  return state;
}

// -------------------------------------------------------------------------
// Cfg generation
// -------------------------------------------------------------------------
// Build a per-preset cfg body that sets all crosshair cvars (CVAR_KEYS), one per line,
// in CVAR_KEYS order. cl_crosshair_screen_height is the LAST key there on
// purpose: the game overwrites it whenever length/thickness/gap change, so it
// must be set after them (same rule as lib/cfg-export.js).
function presetCfgBody(p, label) {
  const lines = [`// auto-generated by cs2-debug.js — ${label}`];
  for (const key of CVAR_KEYS) {
    if (p[key] === null || p[key] === undefined) continue; // normalizeParams fills all keys; be lenient
    lines.push(`${key} ${fmtNum(p[key])}`);
  }
  lines.push(`echo "[DEBUG] crosshair: ${label.replace(/"/g, '')}"`);
  return lines.join('\n') + '\n';
}

// Write cursed_debug.cfg + per-preset cfgs into the CS2 cfg dir.
// Returns the list of preset keybind mappings written.
function writeDebugCfgs({ cfgDir, presets, restore }) {
  ensureDir(cfgDir);
  const fkeys = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8'];
  const usable = presets.slice(0, fkeys.length);

  const bindings = [];
  usable.forEach((preset, i) => {
    const slot = i + 1;
    const fname = `cursed_debug_p${slot}`;
    const fpath = path.join(cfgDir, `${fname}.cfg`);
    fs.writeFileSync(fpath, presetCfgBody(preset.params, `#${slot} ${preset.name}`), 'utf8');
    bindings.push({ slot, key: fkeys[i], cfgName: fname, presetName: preset.name, presetId: preset.id });
  });

  // Restore cfg
  if (restore && restore.params) {
    fs.writeFileSync(
      path.join(cfgDir, 'cursed_debug_restore.cfg'),
      presetCfgBody(restore.params, 'restore (green default)'),
      'utf8',
    );
  }

  // Master cfg
  const masterLines = [
    '// cursed_debug.cfg — auto-generated. exec this in CS2 console.',
    'echo "============================================="',
    'echo "  CURSED CROSSHAIR DEBUG MODE"',
    `echo "  ${usable.length} presets bound to F1..F${usable.length}"`,
    'echo "  F11 = take screenshot"',
    'echo "  F12 = restore green default"',
    'echo "============================================="',
    '',
  ];
  for (const b of bindings) {
    masterLines.push(`unbind ${b.key}; bind ${b.key} "exec ${b.cfgName}; echo [DEBUG] active=#${b.slot} ${b.presetName.replace(/"/g, '')}"`);
  }
  masterLines.push('unbind F11; bind F11 "screenshot"');
  if (restore && restore.params) {
    masterLines.push('unbind F12; bind F12 "exec cursed_debug_restore"');
  }
  masterLines.push('');
  masterLines.push('echo "Ready. Press F1..F' + usable.length + ' to switch crosshair, F11 for screenshot."');
  fs.writeFileSync(path.join(cfgDir, 'cursed_debug.cfg'), masterLines.join('\n') + '\n', 'utf8');

  return bindings;
}

// -------------------------------------------------------------------------
// Screenshot watching
// -------------------------------------------------------------------------
function listJpgs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => /\.(jpe?g|tga|png|bmp)$/i.test(f))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }));
}

async function watchScreenshots({ shotsDir, signal }) {
  ensureDir(APP_SCREENSHOTS_DIR);
  const known = new Set(listJpgs(shotsDir).map((f) => f.name));
  const collected = [];
  console.log(`[debug] Watching ${shotsDir} ...`);
  console.log(`[debug] (any new JPG/TGA appears: copied to data/debug/screenshots/)`);

  while (!signal.cancelled) {
    await sleep(700);
    const current = listJpgs(shotsDir);
    for (const f of current) {
      if (!known.has(f.name)) {
        known.add(f.name);
        const ts = new Date(f.mtime).toISOString().replace(/[:.]/g, '-');
        const dest = path.join(APP_SCREENSHOTS_DIR, `${ts}_${f.name}`);
        fs.copyFileSync(path.join(shotsDir, f.name), dest);
        collected.push({ original: f.name, saved: dest, mtime: f.mtime });
        console.log(`[debug] new screenshot: ${f.name} -> ${path.relative(PROJECT_ROOT, dest)}`);
      }
    }
  }
  return collected;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// -------------------------------------------------------------------------
// CS2 launch
// -------------------------------------------------------------------------
// Open a URL with the OS default handler (Steam URL, browser). A missing
// opener (e.g. no xdg-open on a headless box) must not crash the process.
function openUrl(url) {
  let child;
  if (process.platform === 'win32') {
    child = spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
  } else if (process.platform === 'darwin') {
    child = spawn('open', [url], { detached: true, stdio: 'ignore' });
  } else {
    child = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
  }
  child.on('error', (err) => console.warn(`[debug] could not open ${url}: ${err.message} — open it manually.`));
  child.unref();
}

function launchCs2() {
  const url = 'steam://rungameid/730';
  openUrl(url);
  console.log(`[debug] launched ${url}`);
}

// -------------------------------------------------------------------------
// HTML compare page
// -------------------------------------------------------------------------
function htmlEscape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function generateCompareHtml({ presets, bindings, screenshots }) {
  ensureDir(APP_DEBUG_DIR);
  // Map each binding to its screenshots, in arrival order (kept as before).
  const slotShots = bindings.map((b) => ({ ...b, shots: [] }));
  // Naive matching: assign screenshots sequentially in slot order.
  // Better matching is hard without console-output parsing; user can rename.
  const shotsByMtime = [...screenshots].sort((a, b) => a.mtime - b.mtime);
  let bIdx = 0;
  for (const s of shotsByMtime) {
    if (bIdx >= slotShots.length) bIdx = 0;
    slotShots[bIdx].shots.push(s);
    bIdx++;
  }

  const items = slotShots.map((b) => {
    const preset = presets.find((p) => p.id === b.presetId) || { name: b.presetName, params: {} };
    const params = preset.params || {};
    const shotImgs = b.shots.length === 0
      ? '<div class="no-shot">No screenshot yet — press ' + htmlEscape(b.key) + ' then F11 in CS2.</div>'
      : b.shots.map((s) => `<img src="screenshots/${htmlEscape(path.basename(s.saved))}" alt="screenshot" />`).join('');
    return `
<section class="row">
  <header><h2>#${b.slot} <span class="key">${htmlEscape(b.key)}</span> — ${htmlEscape(preset.name)}</h2></header>
  <div class="cmp">
    <div class="col">
      <h3>App preview (real renderer)</h3>
      <div class="canvas preview" id="preview-${b.slot}"></div>
      <pre class="params">${htmlEscape(JSON.stringify(params, null, 2))}</pre>
    </div>
    <div class="col">
      <h3>In-game screenshot</h3>
      <div class="canvas shots">${shotImgs}</div>
    </div>
  </div>
</section>`;
  }).join('\n');

  const presetsJson = JSON.stringify(slotShots.map((b) => {
    const preset = presets.find((p) => p.id === b.presetId) || { params: {} };
    return { slot: b.slot, params: preset.params };
  }));

  // /static/js/preview.js wird vom lokalen Compare-Server (cmdCompare) zur App
  // durchgereicht — same-origin, sonst blockt CORS den Modul-Import.
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<title>Cursed Crosshair — Debug Compare</title>
<style>
  body { background:#0d0f14; color:#e8ecf3; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; padding:24px; margin:0; }
  h1 { font-size:24px; margin:0 0 16px; }
  h2 { font-size:18px; margin:0; }
  h3 { font-size:14px; margin:0 0 8px; color:#9aa3b8; }
  p.hint { color:#9aa3b8; margin:0 0 12px; max-width:900px; }
  .key { background:#ff3b8a; color:#fff; padding:2px 8px; border-radius:4px; font-size:13px; }
  .row { background:#161a23; border:1px solid #2a3142; border-radius:8px; padding:16px; margin-bottom:16px; }
  .row > header { margin-bottom:12px; }
  .toolbar { display:flex; gap:12px; align-items:center; margin-bottom:16px; flex-wrap:wrap; }
  .toolbar select { background:#0d0f14; color:#e8ecf3; border:1px solid #2a3142; border-radius:4px; padding:6px 8px; font-size:13px; }
  .toolbar label { color:#9aa3b8; font-size:12px; }
  .cmp { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  @media (max-width: 1100px) { .cmp { grid-template-columns:1fr; } }
  .canvas { background:#6a6e7a; border:1px solid #2a3142; border-radius:6px; min-height:240px;
            display:flex; align-items:center; justify-content:center; flex-wrap:wrap; gap:8px; padding:8px; }
  .canvas.preview { padding:0; overflow:hidden; }
  .canvas.preview svg { display:block; width:100%; aspect-ratio:4 / 3; }
  .canvas.shots img { max-width:100%; max-height:480px; border-radius:4px; }
  .no-shot { color:#9aa3b8; font-style:italic; }
  .params { font-family:monospace; font-size:11px; color:#9aa3b8; background:#0d0f14;
            padding:8px; border-radius:4px; max-height:160px; overflow:auto; margin-top:8px; }
  .error { background:#3a1520; border:1px solid #ff3b8a; color:#ffd6e5; padding:12px; border-radius:6px; margin-bottom:16px; }
</style>
</head><body>
<h1>Cursed Crosshair — Debug Compare</h1>
<p class="hint">Left: the app's real renderer (<code>public/js/preview.js</code>, shader port + in-game geometry) in game pixels
at the preview's simulated resolution (default 1280×960; 1 SVG unit = 1 game pixel). Right: in-game screenshots, matched to slots in arrival order.</p>
<p class="hint">Take screenshots with the console command <code>screenshot</code> (real render buffer) or as PNG at native
resolution (Win+PrtScn / Xbox Game Bar) — never a scaled/compressed capture. For a numeric pixel comparison use
<code>tools/calib-codes.mjs</code> → <code>calib-expected.mjs</code> → <code>calib-compare.py</code> (see tools/README.md).</p>

<div class="toolbar">
  <label>Zoom <select id="opt-zoom">
    <option value="1" selected>Original (whole render surface)</option><option value="2">2×</option>
    <option value="4">4×</option><option value="6">6×</option><option value="8">8×</option>
  </select></label>
</div>
<div id="load-error" class="error" hidden></div>

${items}
<script type="module">
import { renderCrosshair, ensureSvg } from '/static/js/preview.js';
const data = ${presetsJson};
const ctlZoom = document.getElementById('opt-zoom');

function renderAll() {
  const zoom = Number(ctlZoom.value) || 1;
  for (const item of data) {
    const host = document.getElementById('preview-' + item.slot);
    if (host) renderCrosshair(ensureSvg(host), item.params, { zoom });
  }
}
ctlZoom.addEventListener('change', renderAll);
renderAll();
</script>
<script>
window.addEventListener('error', (e) => {
  const box = document.getElementById('load-error');
  box.hidden = false;
  box.textContent = 'Renderer could not be loaded: ' + (e.message || e) +
    ' — is the app running at the --app-url passed to "compare"?';
}, true);
</script>
</body></html>`;

  const outPath = path.join(APP_DEBUG_DIR, 'compare.html');
  fs.writeFileSync(outPath, html, 'utf8');
  return outPath;
}

// -------------------------------------------------------------------------
// Local compare server: serves data/debug/ and proxies /static/* to the app
// (module import of the real renderer must be same-origin — no CORS on /static).
// -------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.tga': 'application/octet-stream', '.bmp': 'image/bmp',
  '.json': 'application/json', '.js': 'text/javascript',
};

function startCompareServer({ appUrl, port }) {
  const app = new URL(appUrl);
  const server = http.createServer((req, res) => {
    const reqUrl = new URL(req.url, 'http://localhost');
    if (reqUrl.pathname.startsWith('/static/')) {
      // Proxy to the running app (renderer module + its imports + map images).
      const proxyReq = http.request({
        hostname: app.hostname,
        port: app.port || 80,
        path: reqUrl.pathname + reqUrl.search,
        method: 'GET',
        headers: { host: app.host },
      }, (up) => {
        res.writeHead(up.statusCode || 502, up.headers);
        up.pipe(res);
      });
      proxyReq.on('error', (err) => {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end(`upstream ${appUrl} unreachable: ${err.message}`);
      });
      proxyReq.end();
      return;
    }
    // Static files from data/debug/ (no path traversal).
    const rel = decodeURIComponent(reqUrl.pathname === '/' ? '/compare.html' : reqUrl.pathname);
    const file = path.normalize(path.join(APP_DEBUG_DIR, rel));
    if (!file.startsWith(APP_DEBUG_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

function openInBrowser(target) {
  // Accepts an http(s) URL or a local file path.
  openUrl(/^https?:\/\//.test(target) ? target : 'file:///' + target.replace(/\\/g, '/'));
}

// -------------------------------------------------------------------------
// Subcommand implementations
// -------------------------------------------------------------------------
async function cmdDetect(args) {
  const steam = detectSteamPath(args.steam);
  if (!steam) { console.error('Steam not found.'); process.exit(1); }
  const cs2 = detectCs2Paths(steam, { cfgDir: args['cfg-dir'], shotsDir: args['shots-dir'] });
  console.log('Steam:        ', steam);
  console.log('CS2 dir:      ', cs2.cs2Dir, fs.existsSync(cs2.cs2Dir) ? '(found)' : '(missing)');
  console.log('CS2 cfg dir:  ', cs2.cfgDir, fs.existsSync(cs2.cfgDir) ? '(found)' : '(will create)');
  console.log('CS2 shots dir:', cs2.shotsDir, fs.existsSync(cs2.shotsDir) ? '(found)' : '(will be created by CS2)');
}

async function cmdPrepare(args) {
  const steam = detectSteamPath(args.steam);
  if (!steam) throw new Error('Steam not found. Pass --steam <path> manually.');
  const cs2 = detectCs2Paths(steam, { cfgDir: args['cfg-dir'], shotsDir: args['shots-dir'] });
  if (!fs.existsSync(cs2.cs2Dir)) throw new Error(`CS2 not found at ${cs2.cs2Dir}`);
  ensureDir(cs2.cfgDir);

  const appUrl = args['app-url'] || DEFAULT_APP_URL;
  const adminUser = args['admin-user'] || process.env.ADMIN_USER || 'admin';
  const adminPass = args['admin-pass'] || process.env.ADMIN_PASSWORD || 'testpass';

  console.log(`[debug] fetching state from ${appUrl} ...`);
  const state = await fetchAppState({ appUrl, adminUser, adminPass });
  if (!state || !Array.isArray(state.presets)) throw new Error('app returned no presets');
  if (state.presets.length === 0) throw new Error('no presets configured in app');

  const bindings = writeDebugCfgs({
    cfgDir: cs2.cfgDir,
    presets: state.presets,
    restore: state.restore,
  });

  ensureDir(APP_DEBUG_DIR);
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    cfgDir: cs2.cfgDir,
    shotsDir: cs2.shotsDir,
    bindings,
    presets: state.presets,
    restore: state.restore,
    preparedAt: new Date().toISOString(),
  }, null, 2), 'utf8');

  console.log('');
  console.log(`[debug] wrote cursed_debug.cfg + ${bindings.length} per-preset cfg(s) to:`);
  console.log('         ' + cs2.cfgDir);
  console.log('');
  console.log('Next steps:');
  console.log('  1) Start CS2 (or run: node tools/cs2-debug.js launch)');
  console.log('  2) Load any map (e.g. workshop "aim_botz")');
  console.log('  3) Open console (~) and type: exec cursed_debug');
  console.log('  4) Press F1..F' + bindings.length + ' to switch crosshair, F11 to screenshot, F12 to restore');
  console.log('  5) Run: node tools/cs2-debug.js watch    (to capture screenshots live)');
  console.log('     Run: node tools/cs2-debug.js compare  (to render the compare HTML when done)');
}

async function cmdLaunch() {
  launchCs2();
  console.log('[debug] Steam will start CS2. After loading a map, type "exec cursed_debug" in console.');
}

async function cmdWatch() {
  if (!fs.existsSync(STATE_FILE)) throw new Error('Run "prepare" first.');
  const st = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  const signal = { cancelled: false };
  const onSig = () => {
    console.log('\n[debug] stopping watcher ...');
    signal.cancelled = true;
  };
  process.on('SIGINT', onSig);
  process.on('SIGTERM', onSig);
  try {
    const collected = await watchScreenshots({ shotsDir: st.shotsDir, signal });
    console.log(`[debug] collected ${collected.length} screenshot(s).`);
    // append to state
    const prev = (st.screenshots || []);
    st.screenshots = [...prev, ...collected];
    fs.writeFileSync(STATE_FILE, JSON.stringify(st, null, 2), 'utf8');
  } finally {
    process.off('SIGINT', onSig);
    process.off('SIGTERM', onSig);
  }
}

async function cmdCompare(args) {
  if (!fs.existsSync(STATE_FILE)) throw new Error('Run "prepare" first.');
  const st = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  // Pick up any screenshots already in APP_SCREENSHOTS_DIR (in case watcher wasn't run)
  ensureDir(APP_SCREENSHOTS_DIR);
  const onDisk = listJpgs(APP_SCREENSHOTS_DIR).map((f) => ({
    saved: path.join(APP_SCREENSHOTS_DIR, f.name),
    mtime: f.mtime,
  }));
  const out = generateCompareHtml({
    presets: st.presets,
    bindings: st.bindings,
    screenshots: onDisk,
  });
  console.log(`[debug] wrote ${path.relative(PROJECT_ROOT, out)}`);

  const appUrl = args['app-url'] || DEFAULT_APP_URL;
  const port = Number(args.port) || DEFAULT_COMPARE_PORT;
  const server = await startCompareServer({ appUrl, port });
  const url = `http://127.0.0.1:${port}/compare.html`;
  console.log(`[debug] serving ${url}  (renderer proxied from ${appUrl}/static/) — Ctrl+C to stop`);
  openInBrowser(url);
  await new Promise((resolve) => {
    const stop = () => { server.close(); resolve(); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

async function cmdAll(args) {
  await cmdPrepare(args);
  await cmdLaunch();
  console.log('');
  console.log('[debug] Press Ctrl+C when you are done taking screenshots — compare HTML will then be generated.');
  console.log('');
  await cmdWatch();
  await cmdCompare(args);
}

async function cmdClean() {
  if (fs.existsSync(STATE_FILE)) {
    const st = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (st.cfgDir && fs.existsSync(st.cfgDir)) {
      const files = fs.readdirSync(st.cfgDir).filter((f) => /^cursed_debug.*\.cfg$/.test(f));
      for (const f of files) {
        fs.unlinkSync(path.join(st.cfgDir, f));
        console.log('[debug] removed ' + path.join(st.cfgDir, f));
      }
    }
  }
  if (fs.existsSync(APP_DEBUG_DIR)) {
    fs.rmSync(APP_DEBUG_DIR, { recursive: true, force: true });
    console.log('[debug] removed ' + APP_DEBUG_DIR);
  }
}

// -------------------------------------------------------------------------
// main
// -------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || 'help';
  try {
    switch (cmd) {
      case 'detect':  return await cmdDetect(args);
      case 'prepare': return await cmdPrepare(args);
      case 'launch':  return await cmdLaunch();
      case 'watch':   return await cmdWatch();
      case 'compare': return await cmdCompare(args);
      case 'all':     return await cmdAll(args);
      case 'clean':   return await cmdClean();
      case 'help':
      default:
        console.log('Usage: node tools/cs2-debug.js <subcommand> [options]\n');
        console.log('Subcommands: detect, prepare, launch, watch, compare, all, clean\n');
        console.log('See file header for option details.');
        process.exit(cmd === 'help' ? 0 : 1);
    }
  } catch (err) {
    console.error('[debug] ERROR: ' + (err && err.message ? err.message : err));
    process.exit(1);
  }
}

main();
