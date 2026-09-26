// Preview rendering settings — global, persistent in localStorage.
//
//   zoom        Kamera-Zoom auf das Zentrum (viewBox-Crop), aendert keine Geometrie.
//   resolution  Simulierte Spielaufloesung. Das Spiel skaliert die Pixelwerte mit
//               aktuelleHoehe / cl_crosshair_screen_height (Rundung wie im Spiel),
//               deshalb sieht dasselbe Preset bei 960p und 1080p unterschiedlich aus.
//   spreadPx    Simulierter Waffen-Spread in Pixeln fuer die dynamischen Styles
//               (Dynamic Cross/Circle/Quad). 0 = Messer / Ruhe.

const ZOOM_OPTIONS = [1, 2, 3, 4, 6, 8];
export const RESOLUTIONS = [
  { key: '1280x960',  w: 1280, h: 960,  label: '1280×960 (4:3)' },
  { key: '1440x1080', w: 1440, h: 1080, label: '1440×1080 (4:3)' },
  { key: '1280x720',  w: 1280, h: 720,  label: '1280×720' },
  { key: '1920x1080', w: 1920, h: 1080, label: '1920×1080' },
  { key: '2560x1440', w: 2560, h: 1440, label: '2560×1440' },
];
const SPREAD_MAX = 320;
const DEFAULTS = { zoom: 1, resolution: '1920x1080', spreadPx: 0 };
const KEYS = { zoom: 'ccg.preview.zoom', resolution: 'ccg.preview.resolution', spreadPx: 'ccg.preview.spread' };

function read(key, validate) {
  try {
    const raw = localStorage.getItem(KEYS[key]);
    if (raw === null) return DEFAULTS[key];
    const v = validate(raw);
    return v === null ? DEFAULTS[key] : v;
  } catch (_e) { return DEFAULTS[key]; }
}
function write(key, v) { try { localStorage.setItem(KEYS[key], String(v)); } catch (_e) { /* ignore */ } }

const state = {
  kick: 0, // Legacy-Rueckstoss (Style 5), nur waehrend der Dynamic Preview > 0
  zoom: read('zoom', (r) => (ZOOM_OPTIONS.includes(Number(r)) ? Number(r) : null)),
  resolution: read('resolution', (r) => (RESOLUTIONS.some((x) => x.key === r) ? r : null)),
  spreadPx: read('spreadPx', (r) => { const n = Number(r); return Number.isFinite(n) ? Math.max(0, Math.min(SPREAD_MAX, Math.round(n))) : null; }),
};

const listeners = new Set();
function notify() { for (const fn of listeners) { try { fn(); } catch (_e) { /* ignore */ } } }

function set(key, v) {
  if (state[key] === v) return;
  state[key] = v;
  write(key, v);
  notify();
}

export function getSettings() { return { ...state }; }

// ---------------------------------------------------------------------------
// Dynamic Preview: animiert spreadPx wie das "Dynamic Preview" im Spiel-Menue.
// Ablauf (Annaeherung, das Skript des Spiels ist nicht bekannt): Stillstand ->
// Laufen (Spread waechst auf ~100 px und pendelt) -> Stehenbleiben -> 6 Schuesse
// (jeder Schuss +110 px, klingt in ~0.35 s ab) -> zurueck zu 0. Schleife.
// ---------------------------------------------------------------------------
const STAGES = [
  { t: 1.2, f: () => 0 },
  { t: 0.6, f: (u) => 100 * u },
  { t: 1.8, f: (u) => 100 + 12 * Math.sin(u * Math.PI * 6) },
  { t: 0.6, f: (u) => 100 * (1 - u) },
  { t: 0.5, f: () => 0 },
  { t: 1.8, f: (u) => { const k = u * 6; const frac = k - Math.floor(k); return 110 * Math.exp(-frac * 6) * (1 + 0.3 * Math.min(Math.floor(k), 3)); } },
  { t: 0.5, f: (u) => 130 * Math.exp(-u * 6) },
];
const CYCLE = STAGES.reduce((a, s) => a + s.t, 0);
let animRaf = 0;
let animStart = 0;
let animLast = 0;
const animListeners = new Set();
export function isDynamicPreview() { return animRaf !== 0; }
export function onDynamicToggle(fn) { animListeners.add(fn); return () => animListeners.delete(fn); }

function spreadAt(time) {
  let t = time % CYCLE;
  for (const st of STAGES) {
    if (t < st.t) return Math.max(0, Math.round(st.f(t / st.t)));
    t -= st.t;
  }
  return 0;
}
// Schusszeitpunkte innerhalb des Zyklus (Stage 6: 6 Schuesse im Abstand von 0.3 s).
const SHOT_STAGE_START = STAGES.slice(0, 5).reduce((a, s) => a + s.t, 0);
const SHOT_TIMES = [0, 1, 2, 3, 4, 5].map((i) => SHOT_STAGE_START + i * 0.3);
let lastCycleTime = 0;
let kickVal = 0;
function animFrame(now) {
  animRaf = requestAnimationFrame(animFrame);
  if (now - animLast < 33) return; // ~30 fps reichen, der Renderer rechnet pro Bild
  const dt = animLast ? (now - animLast) / 1000 : 0;
  animLast = now;
  const time = (now - animStart) / 1000;
  const v = spreadAt(time);
  // Legacy-Kick wie im Spiel: +15 je Schuss, Deckel 25, Abklingen 42/s
  const ct = time % CYCLE;
  const prev = lastCycleTime;
  lastCycleTime = ct;
  for (const st of SHOT_TIMES) {
    if ((prev < st && ct >= st) || (prev > ct && (st >= prev || st < ct))) kickVal += 15;
  }
  kickVal = Math.max(0, Math.min(25, kickVal) - 42 * dt);
  const k = Math.round(kickVal * 100) / 100;
  if (v !== state.spreadPx || k !== state.kick) { state.spreadPx = v; state.kick = k; notify(); }
}
export function setDynamicPreview(on) {
  if (on && !animRaf) {
    animStart = performance.now(); animLast = 0; lastCycleTime = 0; kickVal = 0;
    animRaf = requestAnimationFrame(animFrame);
  } else if (!on && animRaf) {
    cancelAnimationFrame(animRaf); animRaf = 0;
    state.kick = 0;
    state.spreadPx = read('spreadPx', (r) => { const n = Number(r); return Number.isFinite(n) ? Math.max(0, Math.min(SPREAD_MAX, Math.round(n))) : null; });
    notify();
  } else return;
  for (const fn of animListeners) { try { fn(); } catch (_e) { /* ignore */ } }
}
export function getResolution() {
  return RESOLUTIONS.find((r) => r.key === state.resolution) || RESOLUTIONS[0];
}
export function getHorizontalStretch() { return 1; }
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function labeled(text, control) {
  const span = document.createElement('span');
  const lbl = document.createElement('label');
  lbl.textContent = text;
  span.appendChild(lbl);
  span.appendChild(control);
  return span;
}

// Wrapper-Container fuer Preview-Controls. Reihenfolge: extraSlot (i.d.R.
// der Background-Selector), Aufloesung, Zoom, Spread.
export function buildPreviewControls(extraSlot = null) {
  const wrap = document.createElement('div');
  wrap.className = 'preview-controls';
  if (extraSlot) wrap.appendChild(extraSlot);

  const res = document.createElement('select');
  res.className = 'bg-select';
  res.title = 'Simulated game resolution. Pixel values scale with height / cl_crosshair_screen_height, exactly like in CS2.';
  for (const r of RESOLUTIONS) {
    const opt = document.createElement('option');
    opt.value = r.key; opt.textContent = r.label;
    if (r.key === state.resolution) opt.selected = true;
    res.appendChild(opt);
  }
  res.addEventListener('change', () => set('resolution', res.value));
  wrap.appendChild(labeled('Resolution', res));

  const zoom = document.createElement('select');
  zoom.className = 'bg-select';
  for (const z of ZOOM_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = String(z);
    opt.textContent = z === 1 ? 'Original' : `${z}×`;
    if (z === state.zoom) opt.selected = true;
    zoom.appendChild(opt);
  }
  zoom.addEventListener('change', () => set('zoom', Number(zoom.value)));
  wrap.appendChild(labeled('Zoom', zoom));

  const spreadWrap = document.createElement('span');
  spreadWrap.className = 'preview-spread';
  spreadWrap.title = 'Simulated weapon spread in pixels for the dynamic styles (Dynamic Cross, Dynamic Circle, Dynamic Quad). 0 = knife / standing still.';
  const spread = document.createElement('input');
  spread.type = 'range'; spread.min = '0'; spread.max = String(SPREAD_MAX); spread.step = '1';
  spread.value = String(state.spreadPx);
  const val = document.createElement('output');
  val.textContent = `${state.spreadPx} px`;
  spread.addEventListener('input', () => {
    const n = Math.round(Number(spread.value));
    val.textContent = `${n} px`;
    set('spreadPx', n);
  });
  const lbl = document.createElement('label');
  lbl.textContent = 'Spread';
  spreadWrap.appendChild(lbl);
  spreadWrap.appendChild(spread);
  spreadWrap.appendChild(val);
  wrap.appendChild(spreadWrap);

  // Dynamic Preview (Animation des Spreads wie im Spiel-Menue)
  const dyn = document.createElement('button');
  dyn.type = 'button';
  dyn.className = 'btn btn-sm';
  dyn.title = 'Animate weapon spread (walk, stop, shoot) for the dynamic styles, like the Dynamic Preview in the CS2 settings.';
  const syncDyn = () => {
    const on = isDynamicPreview();
    dyn.textContent = on ? 'Stop Dynamic Preview' : 'Start Dynamic Preview';
    dyn.classList.toggle('active', on);
    spread.disabled = on;
    if (!on) { spread.value = String(state.spreadPx); val.textContent = `${state.spreadPx} px`; }
  };
  dyn.addEventListener('click', () => setDynamicPreview(!isDynamicPreview()));
  onDynamicToggle(syncDyn);
  listeners.add(() => { if (isDynamicPreview()) { spread.value = String(state.spreadPx); val.textContent = `${state.spreadPx} px`; } });
  syncDyn();
  wrap.appendChild(dyn);

  return wrap;
}
