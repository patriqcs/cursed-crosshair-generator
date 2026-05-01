// Builds the parameter editor UI bound to a state object and an onChange callback.
// Used by both the public submission page and the admin presets editor.

// Cursed-mode limits. Slider min/max match these and number inputs are
// clamped on input + on blur so out-of-range values are cut off.
//
// outlinethickness ist Integer 0..3 (CS2 cvar-Range). 0 = "Outline gezeichnet
// aber unsichtbar duenn"-Sentinel, der drawoutline-Toggle bestimmt zusaetzlich
// ob die Outline ueberhaupt aktiv ist.
export const FIELD_LIMITS = Object.freeze({
  cl_crosshairsize: { min: 0, max: 500 },
  cl_crosshairthickness: { min: 0, max: 500 },
  cl_crosshairgap: { min: -500, max: 500 },
  cl_crosshair_outlinethickness: { min: 0, max: 3 },
});

// CS2 crosshair styles — nur die im Spiel ueber das Settings-Menue verfuegbaren
// Werte. Default (0), Default Static (1) und Classic Dynamic (3) zeigen sich in
// CS2 nicht im UI und werden hier weggelassen.
const STYLE_OPTIONS = [
  { value: 2, label: 'Classic' },
  { value: 4, label: 'Classic Static' },
  { value: 5, label: 'Legacy' },
];

const STYLE_INFO_HTML = `
<p><strong>Classic:</strong> dynamic crosshair with straight lines that expand when moving and crouching, and move to a lesser extent when shooting and switching weapons. Handy for learning the game's mechanics, but can be distracting.</p>
<p><strong>Classic Static:</strong> never moves. By far the most preferred option for experienced players.</p>
<p><strong>Legacy:</strong> only extends when firing your weapon, indicating spread (somewhat). Sometimes used by pros, but generally inferior to Classic Static.</p>
`;

const FIELDS = [
  {
    type: 'segmented',
    key: 'cl_crosshairstyle',
    label: 'Style (cl_crosshairstyle)',
    options: STYLE_OPTIONS,
    infoHtml: STYLE_INFO_HTML,
  },
  {
    type: 'slider',
    key: 'cl_crosshairsize',
    label: 'Size (cl_crosshairsize)',
    min: 0, max: 500, step: 0.1,
  },
  {
    type: 'slider',
    key: 'cl_crosshairthickness',
    label: 'Thickness (cl_crosshairthickness)',
    min: 0, max: 500, step: 0.1,
  },
  {
    type: 'slider',
    key: 'cl_crosshairgap',
    label: 'Gap (cl_crosshairgap)',
    // Integer-Step: CS2 rendert Rects mit Integer-Pixel-Koordinaten,
    // fraktioneller Gap macht visuell oft keinen Unterschied. Existierende
    // Dezimal-Werte (z.B. -4.3 vom alten gruenen Default) werden beim
    // Editieren auf den naechsten Integer gerundet.
    min: -500, max: 500, step: 1,
  },
  { type: 'toggle', key: 'cl_crosshairdot', label: 'Center Dot (cl_crosshairdot)' },
  { type: 'toggle', key: 'cl_crosshair_t',  label: 'T-Style (cl_crosshair_t)' },
  { type: 'toggle', key: 'cl_crosshair_recoil', label: 'Recoil (cl_crosshair_recoil)' },
  { type: 'toggle', key: 'cl_crosshair_drawoutline', label: 'Draw Outline (cl_crosshair_drawoutline)' },
  {
    type: 'slider',
    key: 'cl_crosshair_outlinethickness',
    label: 'Outline Thickness (cl_crosshair_outlinethickness)',
    min: 0, max: 3, step: 1,
  },
  { type: 'toggle', key: 'cl_crosshairusealpha', label: 'Use Alpha (cl_crosshairusealpha)' },
  {
    type: 'slider',
    key: 'cl_crosshairalpha',
    label: 'Alpha (cl_crosshairalpha)',
    min: 0, max: 255, step: 1,
  },
  { type: 'rgb', key: 'rgb', label: 'Color (RGB)' },
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
  const initial = clampStep(params[field.key] ?? field.min, field.min, field.max, field.step);
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

function buildSegmented(field, params, onChange) {
  const wrap = el('div', { class: 'field' });
  const labelRow = el('div', { class: 'label-row' });
  const labelEl = el('label', null, field.label);
  labelEl.style.margin = '0';
  labelRow.appendChild(labelEl);
  if (field.infoHtml) labelRow.appendChild(buildInfoButton(field.infoHtml));
  wrap.appendChild(labelRow);
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

function buildRgb(_field, params, onChange) {
  const wrap = el('div', { class: 'field' });
  wrap.appendChild(el('label', null, 'Color (RGB 0-255)'));
  const row = el('div', { style: 'display:grid; grid-template-columns: auto 1fr 1fr 1fr; gap:6px; align-items:center;' });

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

function buildOptionalNumber(field, params, onChange) {
  const wrap = el('div', { class: 'field' });
  const has = params[field.key] !== null && params[field.key] !== undefined;
  const initial = has ? clampStep(params[field.key], field.min, field.max, field.step) : 3;
  if (has) params[field.key] = initial;

  const row = el('div', { class: 'field-row' });
  const label = el('label', null, field.label);
  const toggleLbl = el('label', { class: 'toggle' });
  const tog = el('input', { type: 'checkbox' });
  if (has) tog.checked = true;
  toggleLbl.appendChild(tog);
  toggleLbl.appendChild(el('span', { class: 'toggle-slider' }));

  const num = el('input', {
    type: 'number', step: field.step, min: field.min, max: field.max,
    value: initial,
  });
  if (!has) num.disabled = true;

  tog.addEventListener('change', () => {
    if (tog.checked) {
      params[field.key] = clampStep(Number(num.value), field.min, field.max, field.step);
      num.value = String(params[field.key]);
      num.disabled = false;
    } else {
      params[field.key] = null;
      num.disabled = true;
    }
    onChange();
  });
  num.addEventListener('input', () => {
    if (!tog.checked) return;
    const v = Number(num.value);
    if (Number.isFinite(v)) {
      params[field.key] = clamp(v, field.min, field.max);
      onChange();
    }
  });
  num.addEventListener('blur', () => {
    if (!tog.checked) return;
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

  wrap.appendChild(label);
  wrap.appendChild(toggleLbl);
  wrap.appendChild(num);
  return wrap;
}

function buildAdvanced(field, params, onChange) {
  const det = el('details', { class: 'advanced' });
  det.appendChild(el('summary', null, field.label));
  for (const child of field.children) {
    det.appendChild(buildField(child, params, onChange));
  }
  return det;
}

function buildField(field, params, onChange) {
  switch (field.type) {
    case 'slider': return buildSlider(field, params, onChange);
    case 'toggle': return buildToggle(field, params, onChange);
    case 'segmented': return buildSegmented(field, params, onChange);
    case 'rgb': return buildRgb(field, params, onChange);
    case 'optionalNumber': return buildOptionalNumber(field, params, onChange);
    case 'advanced': return buildAdvanced(field, params, onChange);
  }
  return el('div');
}

export function buildEditor(host, params, onChange) {
  host.innerHTML = '';
  for (const field of FIELDS) {
    host.appendChild(buildField(field, params, onChange));
  }
}

export const DEFAULT_PARAMS = Object.freeze({
  cl_crosshairstyle: 4,
  cl_crosshairsize: 4,
  cl_crosshairthickness: 1.2,
  cl_crosshairgap: -2,
  cl_crosshairdot: 0,
  cl_crosshair_t: 0,
  cl_crosshair_recoil: 0,
  cl_crosshair_drawoutline: 1,
  cl_crosshair_outlinethickness: 1,
  cl_crosshairusealpha: 1,
  cl_crosshairalpha: 220,
  cl_crosshaircolor_r: 0,
  cl_crosshaircolor_g: 255,
  cl_crosshaircolor_b: 0,
  cl_crosshair_dynamic_splitdist: null,
});

export function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

// Quantisiere v auf das nächste Vielfache von step. Verhindert Werte wie 0.01
// bei step=0.1 — sonst sind manche Crosshairs in CS2 unsichtbar.
function quantize(v, step) {
  if (!Number.isFinite(step) || step <= 0) return v;
  const decimals = step < 1 ? Math.max(0, -Math.floor(Math.log10(step))) : 0;
  const factor = Math.pow(10, decimals);
  return Math.round(v * factor) / factor;
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
