#!/usr/bin/env node
'use strict';

// CS2 Crosshair Debug CLI
// =======================
//
// Generates a CS2 cfg with the current presets bound to F1-F8, then watches
// the CS2 screenshots folder and produces a compare HTML page (SVG preview
// vs in-game screenshot).
//
// Subcommands:
//   prepare     write cursed_debug.cfg + per-preset cfgs into CS2's cfg dir
//   launch      launch CS2 via Steam URL (opens Steam, you must press Play)
//   watch       poll the CS2 screenshots dir, copy new JPGs into data/debug/
//   compare     generate data/debug/compare.html and print the file:// URL
//   all         prepare + launch + watch (Ctrl+C to stop) + compare
//   detect      print detected paths and exit
//   clean       remove generated cfgs and copied screenshots
//
// VAC-safe: only writes cfg files and starts CS2 via Steam URL — no input
// injection, no memory access, no DLL injection. Screenshots are taken by
// CS2's built-in `screenshot` console command (bound to F11 by default).
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

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { execFileSync, spawn } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
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
function fmtNum(n) {
  if (n === null || n === undefined) return '0';
  if (Number.isInteger(n)) return String(n);
  return Number(n).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

// Build a per-preset cfg body that sets all crosshair cvars in one go.
function presetCfgBody(p, label) {
  const lines = [
    `// auto-generated by cs2-debug.js — ${label}`,
    `cl_crosshairstyle ${fmtNum(p.cl_crosshairstyle)}`,
    `cl_crosshairsize ${fmtNum(p.cl_crosshairsize)}`,
    `cl_crosshairthickness ${fmtNum(p.cl_crosshairthickness)}`,
    `cl_crosshairgap ${fmtNum(p.cl_crosshairgap)}`,
    `cl_crosshairdot ${fmtNum(p.cl_crosshairdot)}`,
    `cl_crosshair_t ${fmtNum(p.cl_crosshair_t)}`,
    `cl_crosshair_recoil ${fmtNum(p.cl_crosshair_recoil)}`,
    `cl_crosshair_drawoutline ${fmtNum(p.cl_crosshair_drawoutline)}`,
    `cl_crosshair_outlinethickness ${fmtNum(p.cl_crosshair_outlinethickness)}`,
    `cl_crosshairusealpha ${fmtNum(p.cl_crosshairusealpha)}`,
    `cl_crosshairalpha ${fmtNum(p.cl_crosshairalpha)}`,
    'cl_crosshaircolor 5',
    `cl_crosshaircolor_r ${fmtNum(p.cl_crosshaircolor_r)}`,
    `cl_crosshaircolor_g ${fmtNum(p.cl_crosshaircolor_g)}`,
    `cl_crosshaircolor_b ${fmtNum(p.cl_crosshaircolor_b)}`,
  ];
  if (p.cl_crosshair_dynamic_splitdist !== null && p.cl_crosshair_dynamic_splitdist !== undefined) {
    lines.push(`cl_crosshair_dynamic_splitdist ${fmtNum(p.cl_crosshair_dynamic_splitdist)}`);
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
function launchCs2() {
  const url = 'steam://rungameid/730';
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
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
  // Map each binding to (up to 3 most-recent) screenshots, in order
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
      <h3>SVG preview</h3>
      <div class="canvas">
        <svg id="svg-${b.slot}" viewBox="0 0 500 500"></svg>
      </div>
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

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<title>Cursed Crosshair — Debug Compare</title>
<style>
  body { background:#0d0f14; color:#e8ecf3; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; padding:24px; margin:0; }
  h1 { font-size:24px; margin:0 0 16px; }
  h2 { font-size:18px; margin:0; }
  h3 { font-size:14px; margin:0 0 8px; color:#9aa3b8; }
  .key { background:#ff3b8a; color:#fff; padding:2px 8px; border-radius:4px; font-size:13px; }
  .row { background:#161a23; border:1px solid #2a3142; border-radius:8px; padding:16px; margin-bottom:16px; }
  .row > header { margin-bottom:12px; }
  .toolbar { display:flex; gap:12px; align-items:center; margin-bottom:16px; flex-wrap:wrap; }
  .toolbar select, .toolbar input { background:#0d0f14; color:#e8ecf3; border:1px solid #2a3142; border-radius:4px; padding:6px 8px; font-size:13px; }
  .toolbar label { color:#9aa3b8; font-size:12px; }
  .cmp { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  @media (max-width: 1100px) { .cmp { grid-template-columns:1fr; } }
  .canvas { background:#6a6e7a; border:1px solid #2a3142; border-radius:6px; min-height:240px;
            display:flex; align-items:center; justify-content:center; flex-wrap:wrap; gap:8px; padding:8px; }
  .canvas svg { width:100%; max-width:500px; aspect-ratio:1; }
  .canvas.shots img { max-width:100%; max-height:480px; border-radius:4px; }
  .no-shot { color:#9aa3b8; font-style:italic; }
  .params { font-family:monospace; font-size:11px; color:#9aa3b8; background:#0d0f14;
            padding:8px; border-radius:4px; max-height:160px; overflow:auto; margin-top:8px; }
</style>
</head><body>
<h1>Cursed Crosshair — Debug Compare</h1>
<p style="color:#9aa3b8;">SVG preview (left) vs in-game screenshot (right). Adjust scale/aspect/mode below to match your CS2 setup.</p>

<div class="toolbar">
  <label>Aspect <select id="opt-aspect">
    <option value="16:9" selected>16:9</option>
    <option value="16:10">16:10</option>
    <option value="4:3">4:3</option>
  </select></label>
  <label>Resolution <select id="opt-res"></select></label>
  <label>Mode <select id="opt-mode">
    <option value="native" selected>Native</option>
    <option value="stretched">Stretched</option>
    <option value="blackbars">Black bars</option>
  </select></label>
  <label>Zoom <select id="opt-zoom">
    <option value="1">1×</option><option value="2">2×</option>
    <option value="4" selected>4×</option><option value="6">6×</option>
    <option value="8">8×</option><option value="12">12×</option>
  </select></label>
</div>

${items}
<script>
${SVG_RENDER_FN}
const data = ${presetsJson};

const RES_BY_ASPECT = {
  '16:9':  ['1280x720','1366x768','1600x900','1920x1080','2560x1440','3840x2160'],
  '16:10': ['1280x800','1440x900','1680x1050','1920x1200','2560x1600'],
  '4:3':   ['1024x768','1280x960','1440x1080','1600x1200','1920x1440'],
};
const DEFAULT_RES = { '16:9': '1920x1080', '16:10': '1680x1050', '4:3': '1440x1080' };

const ctlZoom = document.getElementById('opt-zoom');
const ctlAspect = document.getElementById('opt-aspect');
const ctlMode = document.getElementById('opt-mode');
const ctlRes = document.getElementById('opt-res');

function fillRes() {
  const list = RES_BY_ASPECT[ctlAspect.value] || RES_BY_ASPECT['16:9'];
  ctlRes.innerHTML = '';
  for (const r of list) {
    const o = document.createElement('option');
    o.value = r; o.textContent = r;
    ctlRes.appendChild(o);
  }
  ctlRes.value = DEFAULT_RES[ctlAspect.value] || list[0];
}

// hStretch assumes a 16:9 display in stretched mode (typical modern monitor).
function getHStretch() {
  if (ctlMode.value !== 'stretched') return 1;
  const [a, b] = ctlAspect.value.split(':').map(Number);
  if (!a || !b) return 1;
  return (16/9) / (a/b);
}

function renderAll() {
  const scale = Number(ctlZoom.value);
  const hStretch = getHStretch();
  for (const item of data) {
    const svg = document.getElementById('svg-' + item.slot);
    if (svg) renderCrosshair(svg, item.params, scale, hStretch);
  }
}

ctlAspect.addEventListener('change', () => { fillRes(); renderAll(); });
[ctlZoom, ctlMode, ctlRes].forEach((el) => el.addEventListener('change', renderAll));
fillRes();
renderAll();
</script>
</body></html>`;

  const outPath = path.join(APP_DEBUG_DIR, 'compare.html');
  fs.writeFileSync(outPath, html, 'utf8');
  return outPath;
}

// Inline copy of the renderer (so the compare HTML is self-contained).
const SVG_RENDER_FN = `
const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEW = 500, CENTER = 250;
function svgEl(name, attrs) {
  const el = document.createElementNS(SVG_NS, name);
  if (attrs) for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k]);
  return el;
}
function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
function clamp255(v){v=Number(v);return Number.isFinite(v)?Math.max(0,Math.min(255,Math.round(v))):0;}
function renderCrosshair(svg, p, scale, hStretch) {
  scale = scale || 4; hStretch = hStretch || 1;
  clear(svg);
  svg.setAttribute('viewBox', '0 0 500 500');
  if (!p) return;
  const sizeRaw = Number(p.cl_crosshairsize);
  const dot = (p.cl_crosshairdot ?? 0) === 1;
  if (Number.isFinite(sizeRaw) && sizeRaw <= 0 && !dot) return;
  const r = clamp255(p.cl_crosshaircolor_r ?? 0);
  const g = clamp255(p.cl_crosshaircolor_g ?? 255);
  const b = clamp255(p.cl_crosshaircolor_b ?? 0);
  const useAlpha = (p.cl_crosshairusealpha ?? 0) === 1;
  const alpha = clamp255(p.cl_crosshairalpha ?? 255);
  const opacity = useAlpha ? alpha / 255 : 1;
  const fill = 'rgb(' + r + ',' + g + ',' + b + ')';
  const drawOutline = (p.cl_crosshair_drawoutline ?? 0) === 1;
  const outlineWidth = drawOutline ? Math.max(0, p.cl_crosshair_outlinethickness ?? 0) * scale : 0;
  const outlineX = outlineWidth * hStretch;
  const size = Math.max(0, p.cl_crosshairsize ?? 0);
  const thickness = Math.max(0, p.cl_crosshairthickness ?? 0);
  const gap = Number.isFinite(p.cl_crosshairgap) ? p.cl_crosshairgap : 0;
  const showT = (p.cl_crosshair_t ?? 0) === 1;
  const dirs = showT ? ['bottom','left','right'] : ['top','bottom','left','right'];
  function lineRect(d) {
    if (size <= 0 || thickness <= 0) return null;
    const len = size * scale, w = thickness * scale, off = gap * scale;
    if (d === 'top') { const sw = w * hStretch; return { x: CENTER - sw/2, y: CENTER - off - len, width: sw, height: len }; }
    if (d === 'bottom') { const sw = w * hStretch; return { x: CENTER - sw/2, y: CENTER + off, width: sw, height: len }; }
    if (d === 'left')  { const sl = len * hStretch, so = off * hStretch; return { x: CENTER - so - sl, y: CENTER - w/2, width: sl, height: w }; }
    const sl = len * hStretch, so = off * hStretch;
    return { x: CENTER + so, y: CENTER - w/2, width: sl, height: w };
  }
  if (outlineWidth > 0) {
    for (const d of dirs) { const r2 = lineRect(d); if (!r2) continue;
      svg.appendChild(svgEl('rect', { x: r2.x - outlineX, y: r2.y - outlineWidth,
        width: r2.width + outlineX*2, height: r2.height + outlineWidth*2, fill: '#000', opacity })); }
    if (dot && thickness > 0) { const dw = thickness * scale, dwx = dw * hStretch;
      svg.appendChild(svgEl('rect', { x: CENTER - dwx/2 - outlineX, y: CENTER - dw/2 - outlineWidth,
        width: dwx + outlineX*2, height: dw + outlineWidth*2, fill: '#000', opacity })); }
  }
  for (const d of dirs) { const r2 = lineRect(d); if (!r2) continue;
    svg.appendChild(svgEl('rect', { x: r2.x, y: r2.y, width: r2.width, height: r2.height, fill, opacity })); }
  if (dot && thickness > 0) { const dw = thickness * scale, dwx = dw * hStretch;
    svg.appendChild(svgEl('rect', { x: CENTER - dwx/2, y: CENTER - dw/2, width: dwx, height: dw, fill, opacity })); }
}
`;

function openInBrowser(filePath) {
  const fileUrl = 'file:///' + filePath.replace(/\\/g, '/');
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', fileUrl], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [fileUrl], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [fileUrl], { detached: true, stdio: 'ignore' }).unref();
  }
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

  const appUrl = args['app-url'] || 'http://localhost:3000';
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

async function cmdCompare() {
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
  console.log(`[debug] file:///${out.replace(/\\/g, '/')}`);
  openInBrowser(out);
}

async function cmdAll(args) {
  await cmdPrepare(args);
  await cmdLaunch();
  console.log('');
  console.log('[debug] Press Ctrl+C when you are done taking screenshots — compare HTML will then be generated.');
  console.log('');
  await cmdWatch();
  await cmdCompare();
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
      case 'compare': return await cmdCompare();
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
