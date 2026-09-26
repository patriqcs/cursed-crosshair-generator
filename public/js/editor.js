// Builds the parameter editor UI bound to a state object and an onChange callback.
// Used by both the public submission page and the admin presets editor.
//
// Seit dem CS2-Update vom 2026-09-22 (neues Crosshair-System) werden die Felder
// aus dem gemeinsamen Cvar-Modell in cvars.js abgeleitet: Ranges, Steps und
// Defaults kommen ausschliesslich von dort. Das Spiel clampt hart auf diese
// Ranges, deshalb sind Slider und Number-Inputs identisch begrenzt.

import {
  CVARS, STYLES, OUTLINE_MODES, isRelevant, defaultParams,
} from './cvars.js';

// Range/Step eines Cvars aus dem Modell lesen (Integer-Cvars: step 1).
function lim(key) {
  const spec = CVARS[key];
  return { min: spec.min, max: spec.max, step: spec.step ?? 1 };
}

const STYLE_INFO_HTML = `
<p><em>Preview:</em> use the Spread slider above the preview to simulate weapon inaccuracy for the dynamic styles. The Classic split bars and the Legacy recoil kick only exist in-game and are not simulated.</p>
<p><strong>Static Cross:</strong> classic four-line crosshair, never moves. The most common choice for experienced players.</p>
<p><strong>Static Circle:</strong> a fixed ring instead of lines.</p>
<p><strong>Static Square:</strong> a fixed square outline instead of lines (added 2026-09-24).</p>
<p><strong>Dot Only:</strong> just the center dot — length, gap and T-style have no effect.</p>
<p><strong>Dynamic Cross:</strong> four lines that spread with movement, crouching and shooting, up to the spread limit.</p>
<p><strong>Dynamic Circle:</strong> a ring that grows with your inaccuracy.</p>
<p><strong>Dynamic Cross (Classic):</strong> the old style 2 — lines split into an inner and outer part while moving (split distance / alpha / ratio settings below).</p>
<p><strong>Dynamic Cross (Legacy/Shot Feedback):</strong> only expands while firing, indicating spread.</p>
<p><strong>Dynamic Quad:</strong> a static cross plus four diagonal arcs that show your current inaccuracy.</p>
<p>All values are pixels at 1920×1080; the game scales them proportionally to your actual screen height.</p>
`;

// Editor-Felder in Anzeige-Reihenfolge. Ranges IMMER via lim() aus CVARS.
const FIELDS = [
  {
    type: 'select',
    key: 'cl_crosshairstyle',
    label: 'Style (cl_crosshairstyle)',
    options: STYLES,
    infoHtml: STYLE_INFO_HTML,
  },
  { type: 'slider', key: 'cl_crosshair_length',    label: 'Length (cl_crosshair_length)',       ...lim('cl_crosshair_length') },
  { type: 'slider', key: 'cl_crosshair_thickness', label: 'Thickness (cl_crosshair_thickness)', ...lim('cl_crosshair_thickness') },
  { type: 'slider', key: 'cl_crosshair_gap',       label: 'Gap (cl_crosshair_gap)',             ...lim('cl_crosshair_gap') },
  { type: 'toggle', key: 'cl_crosshairdot',     label: 'Center Dot (cl_crosshairdot)' },
  { type: 'toggle', key: 'cl_crosshair_t',      label: 'T-Style (cl_crosshair_t)' },
  { type: 'toggle', key: 'cl_crosshair_recoil', label: 'Follow Recoil (cl_crosshair_recoil)' },
  {
    type: 'segmented',
    key: 'cl_crosshair_drawoutline',
    label: 'Outline (cl_crosshair_drawoutline)',
    options: OUTLINE_MODES,
  },
  { type: 'rgb', key: 'rgb', label: 'Color (RGB)' },
  { type: 'slider', key: 'cl_crosshaircolor_a', label: 'Alpha (cl_crosshaircolor_a)', ...lim('cl_crosshaircolor_a') },
  {
    type: 'group',
    key: 'group-dynamic',
    label: 'Dynamic',
    children: [
      { type: 'slider', key: 'cl_crosshair_dynamic_spread_limit', label: 'Spread limit (cl_crosshair_dynamic_spread_limit)', ...lim('cl_crosshair_dynamic_spread_limit') },
    ],
  },
  {
    type: 'group',
    key: 'group-classic',
    label: 'Classic split (Style 2)',
    children: [
      { type: 'slider', key: 'cl_crosshair_dynamic_splitdist',           label: 'Split distance (cl_crosshair_dynamic_splitdist)',       ...lim('cl_crosshair_dynamic_splitdist') },
      { type: 'slider', key: 'cl_crosshair_dynamic_splitalpha_innermod', label: 'Inner alpha (cl_crosshair_dynamic_splitalpha_innermod)', ...lim('cl_crosshair_dynamic_splitalpha_innermod') },
      { type: 'slider', key: 'cl_crosshair_dynamic_splitalpha_outermod', label: 'Outer alpha (cl_crosshair_dynamic_splitalpha_outermod)', ...lim('cl_crosshair_dynamic_splitalpha_outermod') },
      { type: 'slider', key: 'cl_crosshair_dynamic_maxdist_splitratio',  label: 'Split ratio (cl_crosshair_dynamic_maxdist_splitratio)', ...lim('cl_crosshair_dynamic_maxdist_splitratio') },
    ],
  },
];

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k.startsWith('on') && typeof attrs[k] === 'function') {
        node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      } else if (attrs[k] !== undefined && attrs[k] !== null) {
        node.setAttribute(k, attrs[k]);
      }
    }
  }
  if (children) {
    for (const c of [].concat(children)) {
      if (c == null) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
  }
  return node;
}

function buildSlider(field, params, onChange) {
  const wrap = el('div', { class: 'field' });
  wrap.appendChild(el('label', null, field.label));
  const row = el('div', { class: 'field-row' });
  const initial = clampStep(params[field.key] ?? CVARS[field.key].default, field.min, field.max, field.step);
  // Always store the clamped value so reading state never returns out-of-range
  params[field.key] = initial;

  const slider = el('input', {
    type: 'range', min: field.min, max: field.max, step: field.step,
    value: initial,
  });
  const num = el('input', {
    type: 'number', min: field.min, max: field.max, step: field.step,
    value: initial,
  });
  slider.addEventListener('input', () => {
    const v = clampStep(Number(slider.value), field.min, field.max, field.step);
    num.value = String(v);
    params[field.key] = v;
    onChange();
  });
  // While typing, keep slider in sync but don't yet quantize the number input
  // value (so the user can edit it freely). On blur, snap to step.
  num.addEventListener('input', () => {
    const v = Number(num.value);
    if (Number.isFinite(v)) {
      const clamped = clamp(v, field.min, field.max);
      params[field.key] = clamped;
      slider.value = String(clamped);
      onChange();
    }
  });
  num.addEventListener('blur', () => {
    const v = Number(num.value);
    if (!Number.isFinite(v)) {
      num.value = String(params[field.key] ?? field.min);
      return;
    }
    const snapped = clampStep(v, field.min, field.max, field.step);
    if (snapped !== v) {
      num.value = String(snapped);
      params[field.key] = snapped;
      slider.value = String(snapped);
      onChange();
    }
  });
  row.appendChild(slider);
  row.appendChild(num);
  wrap.appendChild(row);
  return wrap;
}

// Reiner Number-Input (ohne Slider), z.B. fuer die Bezugshoehe 240..65535.
function buildNumber(field, params, onChange) {
  const wrap = el('div', { class: 'field' });
  wrap.appendChild(el('label', null, field.label));
  const initial = clampStep(params[field.key] ?? CVARS[field.key].default, field.min, field.max, field.step);
  params[field.key] = initial;

  const num = el('input', {
    type: 'number', min: field.min, max: field.max, step: field.step,
    value: initial,
  });
  num.addEventListener('input', () => {
    const v = Number(num.value);
    if (Number.isFinite(v)) {
      params[field.key] = clamp(v, field.min, field.max);
      onChange();
    }
  });
  num.addEventListener('blur', () => {
    const v = Number(num.value);
    if (!Number.isFinite(v)) {
      num.value = String(params[field.key] ?? field.min);
      return;
    }
    const snapped = clampStep(v, field.min, field.max, field.step);
    if (snapped !== v) {
      num.value = String(snapped);
      params[field.key] = snapped;
      onChange();
    }
  });
  wrap.appendChild(num);
  if (field.note) wrap.appendChild(el('div', { class: 'field-note' }, field.note));
  return wrap;
}

function buildToggle(field, params, onChange) {
  const wrap = el('div', { class: 'field' });
  const row = el('div', { class: 'field-row' });
  row.appendChild(el('label', null, field.label));
  const label = el('label', { class: 'toggle' });
  const input = el('input', {
    type: 'checkbox',
  });
  if ((params[field.key] ?? 0) === 1) input.checked = true;
  input.addEventListener('change', () => {
    params[field.key] = input.checked ? 1 : 0;
    onChange();
  });
  const slider = el('span', { class: 'toggle-slider' });
  label.appendChild(input);
  label.appendChild(slider);
  row.appendChild(label);
  wrap.appendChild(row);
  return wrap;
}

function buildInfoButton(html) {
  // Tooltip wird beim Hover/Focus an document.body portaliert und per
  // position:fixed positioniert — bricht damit aus Modal-Containern
  // (`.modal { overflow:auto }`) und engen Grid-Spalten (three-col 360px)
  // aus, statt vom Container abgeschnitten zu werden / Modal-Scrollbars
  // zu erzeugen. Kein CSS-only-:hover-Toggle mehr; Lifecycle ueber JS.
  const btn = el('span', {
    class: 'info-btn', role: 'button', tabindex: '0',
    'aria-label': 'More info',
  }, '?');
  const tip = el('div', { class: 'info-tooltip', html });

  let attached = false;
  let hideTimer = null;

  function position() {
    const margin = 8;
    const rect = btn.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Tooltip muss bereits im DOM + sichtbar sein, sonst liefert
    // getBoundingClientRect() 0/0 und das Clamping geht schief.
    // requestAnimationFrame waere theoretisch sauberer, aber sync
    // measure reicht — der Browser triggert reflow on demand.
    const tipRect = tip.getBoundingClientRect();
    const tipW = tipRect.width;
    const tipH = tipRect.height;

    // Horizontal: linke Kante am Button ausrichten, ans Viewport clampen.
    let x = rect.left;
    if (x + tipW + margin > vw) x = vw - tipW - margin;
    if (x < margin) x = margin;

    // Vertikal: bevorzugt unter dem Button; passt nichts unten, dann oben;
    // wenn beide nicht reichen, ans Viewport clampen. Tooltip selbst hat
    // max-height + overflow-y, kann also nie hoeher als vh werden.
    let y = rect.bottom + 6;
    if (y + tipH + margin > vh) {
      const above = rect.top - tipH - 6;
      if (above >= margin) y = above;
      else y = Math.max(margin, vh - tipH - margin);
    }

    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }

  function show() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (!attached) {
      document.body.appendChild(tip);
      attached = true;
    }
    tip.classList.add('open');
    position();
  }

  // Verzoegertes Hide, damit Maus von Button -> 6px-Gap -> Tooltip wandern
  // kann ohne dass der Tooltip zwischendurch schliesst (sonst kann der
  // User langen Text nicht in Ruhe lesen / im Tooltip scrollen).
  function scheduleHide() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      tip.classList.remove('open');
      if (attached) {
        tip.remove();
        attached = false;
      }
      hideTimer = null;
    }, 150);
  }

  btn.addEventListener('mouseenter', show);
  btn.addEventListener('mouseleave', scheduleHide);
  btn.addEventListener('focus', show);
  btn.addEventListener('blur', scheduleHide);
  // Tooltip selbst soll Hover halten + Hide-Timer canceln, damit der user
  // reinscrollen / lesen kann.
  tip.addEventListener('mouseenter', show);
  tip.addEventListener('mouseleave', scheduleHide);
  // Bei Scroll im Modal/Viewport oder Resize Tooltip neu positionieren,
  // damit er am Button kleben bleibt. capture=true faengt auch Scroll
  // innerhalb des Modals (overflow:auto auf .modal selbst).
  window.addEventListener('scroll', () => { if (attached) position(); }, true);
  window.addEventListener('resize', () => { if (attached) position(); });

  return btn;
}

function buildLabelRow(field) {
  const labelRow = el('div', { class: 'label-row' });
  const labelEl = el('label', null, field.label);
  labelEl.style.margin = '0';
  labelRow.appendChild(labelEl);
  if (field.infoHtml) labelRow.appendChild(buildInfoButton(field.infoHtml));
  return labelRow;
}

function buildSegmented(field, params, onChange) {
  const wrap = el('div', { class: 'field' });
  wrap.appendChild(buildLabelRow(field));
  const seg = el('div', { class: 'segmented' });
  for (const rawOpt of field.options) {
    const opt = typeof rawOpt === 'object' ? rawOpt : { value: rawOpt, label: String(rawOpt) };
    const btn = el('button', { type: 'button', title: `value: ${opt.value}` }, opt.label);
    if ((params[field.key] ?? 0) === opt.value) btn.classList.add('active');
    btn.addEventListener('click', () => {
      params[field.key] = opt.value;
      seg.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      onChange();
    });
    seg.appendChild(btn);
  }
  wrap.appendChild(seg);
  return wrap;
}

// <select> fuer Enum-Cvars mit vielen Optionen (Style: 9 Eintraege, Labels zu
// lang fuer eine Segmented-Control in der 360px-Editor-Spalte).
function buildSelect(field, params, onChange) {
  const wrap = el('div', { class: 'field' });
  wrap.appendChild(buildLabelRow(field));
  const select = el('select', { class: 'field-select' });
  const current = params[field.key] ?? CVARS[field.key].default;
  for (const opt of field.options) {
    const o = el('option', { value: String(opt.value) }, `${opt.label} (${opt.value})`);
    if (opt.value === current) o.selected = true;
    select.appendChild(o);
  }
  select.addEventListener('change', () => {
    params[field.key] = Number(select.value);
    onChange();
  });
  wrap.appendChild(select);
  return wrap;
}

function buildRgb(_field, params, onChange) {
  const wrap = el('div', { class: 'field' });
  wrap.appendChild(el('label', null, 'Color (RGB 0-255)'));
  const row = el('div', { class: 'rgb-row' });

  const picker = el('input', { type: 'color', value: rgbToHex(params) });
  row.appendChild(picker);

  const inputs = {};
  for (const ch of ['r', 'g', 'b']) {
    const key = `cl_crosshaircolor_${ch}`;
    const inp = el('input', {
      type: 'number', min: 0, max: 255, step: 1,
      value: params[key] ?? 0,
    });
    inp.addEventListener('input', () => {
      const v = clamp(Math.round(Number(inp.value)), 0, 255);
      params[key] = v;
      picker.value = rgbToHex(params);
      onChange();
    });
    inputs[ch] = inp;
    row.appendChild(inp);
  }

  picker.addEventListener('input', () => {
    const { r, g, b } = hexToRgb(picker.value);
    params.cl_crosshaircolor_r = r;
    params.cl_crosshaircolor_g = g;
    params.cl_crosshaircolor_b = b;
    inputs.r.value = String(r);
    inputs.g.value = String(g);
    inputs.b.value = String(b);
    onChange();
  });

  wrap.appendChild(row);
  return wrap;
}

// Aufklappbereich (Dynamic / Classic split).
function buildGroup(field, params, onChange, registry) {
  const det = el('details', { class: 'advanced' });
  det.appendChild(el('summary', null, field.label));
  for (const child of field.children) {
    det.appendChild(buildField(child, params, onChange, registry));
  }
  return det;
}

function buildField(field, params, onChange, registry) {
  let node;
  switch (field.type) {
    case 'slider':    node = buildSlider(field, params, onChange); break;
    case 'number':    node = buildNumber(field, params, onChange); break;
    case 'toggle':    node = buildToggle(field, params, onChange); break;
    case 'segmented': node = buildSegmented(field, params, onChange); break;
    case 'select':    node = buildSelect(field, params, onChange); break;
    case 'rgb':       node = buildRgb(field, params, onChange); break;
    case 'group':     node = buildGroup(field, params, onChange, registry); break;
    default:          node = el('div');
  }
  // Fuer die Style-abhaengige Ausgrauung merken: Feld -> betroffene Cvar-Keys.
  const keys = field.type === 'group'
    ? field.children.map((c) => c.key).filter((k) => k in CVARS)
    : (field.key in CVARS ? [field.key] : []);
  if (keys.length > 0) registry.push({ node, keys });
  return node;
}

// Felder ausgrauen, die fuer den gewaehlten Style im Spiel keine Wirkung haben.
// Werte bleiben erhalten; nur Optik + Bedienbarkeit werden abgeschaltet.
function applyRelevance(registry, style) {
  for (const { node, keys } of registry) {
    const inactive = keys.every((k) => !isRelevant(k, style));
    node.classList.toggle('field--inactive', inactive);
    node.querySelectorAll('input, select, button').forEach((inp) => { inp.disabled = inactive; });
    // Gruppe: alle Felder inaktiv -> Summary bleibt bedienbar (details ist
    // kein Form-Control), Inhalt wird per CSS ausgegraut.
    if (inactive) node.setAttribute('aria-disabled', 'true');
    else node.removeAttribute('aria-disabled');
  }
}

export function buildEditor(host, params, onChange) {
  host.innerHTML = '';
  const registry = [];
  const notify = () => {
    applyRelevance(registry, params.cl_crosshairstyle);
    onChange();
  };
  for (const field of FIELDS) {
    host.appendChild(buildField(field, params, notify, registry));
  }
  applyRelevance(registry, params.cl_crosshairstyle);
}

// Client-Defaults = Cvar-Defaults des Spiels. Die Startwerte der Public-Seite
// kommen vom Server (/api/public/defaults) und ueberschreiben diese.
export const DEFAULT_PARAMS = Object.freeze(defaultParams());

export function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

// Quantisiere v auf das nächste Vielfache von step. Verhindert Werte wie 0.01
// bei step=0.05 — sonst weicht die Preview vom Spiel ab.
function quantize(v, step) {
  if (!Number.isFinite(step) || step <= 0) return v;
  const decimals = step < 1 ? Math.max(0, -Math.floor(Math.log10(step))) : 0;
  const factor = Math.pow(10, decimals);
  const q = Math.round(v / step) * step;
  return Math.round(q * factor) / factor;
}

function clampStep(v, min, max, step) {
  return quantize(clamp(v, min, max), step);
}

function rgbToHex(p) {
  const r = clamp(Math.round(Number(p.cl_crosshaircolor_r ?? 0)), 0, 255);
  const g = clamp(Math.round(Number(p.cl_crosshaircolor_g ?? 0)), 0, 255);
  const b = clamp(Math.round(Number(p.cl_crosshaircolor_b ?? 0)), 0, 255);
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
