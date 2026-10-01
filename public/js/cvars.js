// Gemeinsames Cvar-Modell fuer das CS2-Crosshair-System seit dem "Rush Hour"-Update
// (1.41.8.1, Build 2000913, 2026-09-22; Half-Outline + Static Square seit 1.41.8.3, 2026-09-24;
// Outline-Farbe, Static Quadrant, Thickness 32 und negatives Gap seit 1.41.8.8, 2026-09-30).
//
// Quelle der Ranges/Defaults: SteamDB GameTracking-CS2, DumpSource2/convars.txt (Build 2000922).
// Das Spiel clampt Werte hart auf diese Ranges — "cursed" heisst seither Extremwerte
// innerhalb dieser Grenzen. Wie der Renderer die Werte verwendet (z.B. negatives Gap nur
// im Classic-Style wirksam), steht in preview.js bzw. ~/projects/cs2-re/NOTES.md. Alte Cvars (cl_crosshairsize, cl_crosshairgap, ...) existieren
// nicht mehr bzw. sind hidden; siehe migrate.js.
//
// Wird vom Browser (ESM) UND vom Server (require(esm), Node >= 22) geladen — keine
// DOM-/Node-spezifischen Abhaengigkeiten hier.

export const STYLES = Object.freeze([
  { value: 4, label: 'Static Cross',                       dynamic: false },
  { value: 3, label: 'Static Circle',                      dynamic: false },
  { value: 8, label: 'Static Square',                      dynamic: false },
  { value: 6, label: 'Dot Only',                           dynamic: false },
  { value: 9, label: 'Static Quadrant',                    dynamic: false },
  { value: 0, label: 'Dynamic Cross',                      dynamic: true },
  { value: 1, label: 'Dynamic Circle',                     dynamic: true },
  { value: 2, label: 'Dynamic Cross (Classic)',            dynamic: true },
  { value: 5, label: 'Dynamic Cross (Legacy/Shot Feedback)', dynamic: true },
  { value: 7, label: 'Dynamic Quadrant',                   dynamic: true },
]);
// Reihenfolge wie im CS2-Settings-Dropdown (settings_crosshair.xml).

export const OUTLINE_MODES = Object.freeze([
  { value: 0, label: 'No Outline' },
  { value: 1, label: 'Full Outline' },
  { value: 2, label: 'Half Outline' },
]);

// type: 'int' | 'float' | 'bool' | 'enum'
// group: 'core' (immer im Editor) | 'dynamic' | 'classic' | 'advanced'
export const CVARS = Object.freeze({
  cl_crosshairstyle:                      { type: 'enum',  values: [0,1,2,3,4,5,6,7,8,9], default: 4,    group: 'core' },
  cl_crosshair_length:                    { type: 'int',   min: 0,   max: 255,   default: 8,    group: 'core' },
  cl_crosshair_thickness:                 { type: 'int',   min: 0,   max: 32,    default: 2,    group: 'core' },
  // Cvar-Range seit 2026-09-30: -3840..3840 (Spielmenue: 0..128, Classic -10..128). Negative
  // Werte wirken nur im Classic-Style (2); alle anderen Styles zeichnen sie wie 0 bzw. 1.
  cl_crosshair_gap:                       { type: 'int',   min: -3840, max: 3840, default: 4,   group: 'core' },
  cl_crosshairdot:                        { type: 'bool',  default: 0, group: 'core' },
  cl_crosshair_t:                         { type: 'bool',  default: 0, group: 'core' },
  cl_crosshair_recoil:                    { type: 'bool',  default: 0, group: 'core' },
  cl_crosshair_drawoutline:               { type: 'enum',  values: [0,1,2], default: 1, group: 'core' },
  cl_crosshaircolor_r:                    { type: 'int',   min: 0,   max: 255,   default: 0,    group: 'core' },
  cl_crosshaircolor_g:                    { type: 'int',   min: 0,   max: 255,   default: 255,  group: 'core' },
  cl_crosshaircolor_b:                    { type: 'int',   min: 0,   max: 255,   default: 0,    group: 'core' },
  cl_crosshaircolor_a:                    { type: 'int',   min: 0,   max: 255,   default: 255,  group: 'core' },
  // Outline-Farbe und -Deckkraft (seit 2026-09-30); wirken nur bei drawoutline != 0.
  cl_crosshairoutline_r:                  { type: 'int',   min: 0,   max: 255,   default: 0,    group: 'core' },
  cl_crosshairoutline_g:                  { type: 'int',   min: 0,   max: 255,   default: 0,    group: 'core' },
  cl_crosshairoutline_b:                  { type: 'int',   min: 0,   max: 255,   default: 0,    group: 'core' },
  cl_crosshairoutline_a:                  { type: 'int',   min: 0,   max: 255,   default: 255,  group: 'core' },
  cl_crosshair_dynamic_spread_limit:      { type: 'int',   min: 0,   max: 255,   default: 255,  group: 'dynamic' },
  cl_crosshair_dynamic_splitdist:         { type: 'int',   min: 0,   max: 127,   default: 3,    group: 'classic' },
  // Raster seit 2026-09-30: 0.01 (vorher 0.05) im Menue und im Share-Code.
  cl_crosshair_dynamic_splitalpha_innermod: { type: 'float', min: 0,   max: 1, step: 0.01, default: 0, group: 'classic' },
  cl_crosshair_dynamic_splitalpha_outermod: { type: 'float', min: 0.3, max: 1, step: 0.01, default: 1, group: 'classic' },
  cl_crosshair_dynamic_maxdist_splitratio:  { type: 'float', min: 0,   max: 1, step: 0.01, default: 1, group: 'classic' },
  // Scope-Dot (AUG/SG): seit 2026-09-30 Teil des Crosshair-Settings-Structs und des Share-Codes.
  // Wird exportiert, aber in der Vorschau nicht gezeichnet (nur im Zoom sichtbar).
  cl_ironsight_usecrosshaircolor:         { type: 'bool',  default: 0, group: 'scope' },
  cl_ironsight_dot_scale:                 { type: 'float', min: 0.1, max: 2, step: 0.01, default: 1, group: 'scope' },
  // Bezugshoehe fuer die Pixelwerte; das Spiel skaliert mit aktuelleHoehe / screen_height.
  // Hidden-Cvar; wird vom Spiel bei jeder Size-Aenderung ueberschrieben -> im .cfg IMMER
  // als letztes setzen.
  cl_crosshair_screen_height:             { type: 'int',   min: 240, max: 65535, default: 1080, group: 'advanced' },
});

export const CVAR_KEYS = Object.freeze(Object.keys(CVARS));

// Welche Regler das Spiel je Style anzeigt (settingsmenu_crosshair.js, OnCrosshairStyleChange).
// Outline, Thickness, Farbe/Alpha, Recoil sind immer sichtbar; die Outline-Farbe nur bei
// drawoutline != 0. cl_crosshair_dynamic_maxdist_splitratio hat zwei Rollen: "Split Size
// Ratio" im Classic-Style (2) und "Quadrant Size" im Static Quadrant (9).
const VIS = {
  0: ['dot', 'gap', 'length', 't', 'spread'],
  1: ['dot', 'spread'],
  2: ['dot', 'gap', 'length', 't', 'classic', 'ratio'],
  3: ['dot', 'gap'],
  4: ['dot', 'gap', 'length', 't'],
  5: ['dot', 'gap', 'length', 't'],
  6: [],
  7: ['dot', 'gap', 'length', 't', 'spread'],
  8: ['dot', 'gap'],
  9: ['dot', 'gap', 'ratio'],
};
const KEY_FEATURE = {
  cl_crosshairdot: 'dot',
  cl_crosshair_gap: 'gap',
  cl_crosshair_length: 'length',
  cl_crosshair_t: 't',
  cl_crosshair_dynamic_spread_limit: 'spread',
  cl_crosshair_dynamic_splitdist: 'classic',
  cl_crosshair_dynamic_splitalpha_innermod: 'classic',
  cl_crosshair_dynamic_splitalpha_outermod: 'classic',
  cl_crosshair_dynamic_maxdist_splitratio: 'ratio',
};
const OUTLINE_COLOR_KEYS = new Set([
  'cl_crosshairoutline_r', 'cl_crosshairoutline_g', 'cl_crosshairoutline_b', 'cl_crosshairoutline_a',
]);

// true, wenn der Cvar fuer den gegebenen Style im Spiel eine Wirkung hat.
// `params` ist optional; damit wird zusaetzlich die Outline-Farbe bei
// cl_crosshair_drawoutline 0 als wirkungslos erkannt.
export function isRelevant(key, style, params = null) {
  if (OUTLINE_COLOR_KEYS.has(key)) {
    return !params || Number(params.cl_crosshair_drawoutline) !== 0;
  }
  const f = KEY_FEATURE[key];
  if (!f) return true;
  const list = VIS[style] || VIS[4];
  return list.includes(f);
}

export function defaultParams() {
  const out = {};
  for (const k of CVAR_KEYS) out[k] = CVARS[k].default;
  return out;
}

function clamp(n, min, max) { return Math.min(Math.max(n, min), max); }

function toNumber(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' && v.trim() !== '') {
    const s = v.trim().toLowerCase();
    if (s === 'true') return 1;
    if (s === 'false') return 0;
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// Normalisiert EINEN Wert auf den gueltigen Bereich/Typ des Cvars. null = ungueltig.
export function normalizeValue(key, raw) {
  const spec = CVARS[key];
  if (!spec) return null;
  const n = toNumber(raw);
  if (n === null) return null;
  switch (spec.type) {
    case 'bool': return n ? 1 : 0;
    case 'enum': {
      // Wie das Spiel: auf den erlaubten Bereich clampen statt ablehnen.
      const r = clamp(Math.round(n), spec.values[0], spec.values[spec.values.length - 1]);
      return spec.values.includes(r) ? r : spec.default;
    }
    case 'int': return clamp(Math.round(n), spec.min, spec.max);
    case 'float': {
      const step = spec.step || 0.01;
      const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
      const q = Math.round(clamp(n, spec.min, spec.max) / step) * step;
      return Number(q.toFixed(decimals));
    }
  }
  return null;
}

// Normalisiert ein komplettes Param-Objekt. Fehlende Keys bekommen Defaults
// (strict=false) oder machen das Objekt ungueltig (strict=true). Unbekannte Keys
// werden verworfen. Rueckgabe null bei ungueltigen Werten.
export function normalizeParams(input, { strict = false } = {}) {
  if (!input || typeof input !== 'object') return null;
  const out = {};
  for (const k of CVAR_KEYS) {
    const raw = input[k];
    if (raw === undefined || raw === null || raw === '') {
      if (strict) return null;
      out[k] = CVARS[k].default;
      continue;
    }
    const v = normalizeValue(k, raw);
    if (v === null) return null;
    out[k] = v;
  }
  return out;
}

// Params aus der Zeit vor dem Update vom 2026-09-30 kennen keine Outline-Farbe. Damals
// zeichnete das Spiel die Outline schwarz mit der Deckkraft des Crosshairs; genau so
// rechnet der Client alte Share-Codes um (Outline-RGB 0, Outline-Alpha = Crosshair-Alpha).
// Gibt ein neues Objekt zurueck; Params mit Outline-Keys bleiben unveraendert.
export function fillMissingOutline(p) {
  if (!p || typeof p !== 'object') return p;
  if ('cl_crosshairoutline_a' in p || 'cl_crosshairoutline_r' in p
    || 'cl_crosshairoutline_g' in p || 'cl_crosshairoutline_b' in p) return p;
  if (!('cl_crosshaircolor_a' in p)) return p;
  return {
    ...p,
    cl_crosshairoutline_r: 0,
    cl_crosshairoutline_g: 0,
    cl_crosshairoutline_b: 0,
    cl_crosshairoutline_a: p.cl_crosshaircolor_a,
  };
}

// Erkennung alter Param-Objekte (vor dem Update).
export const LEGACY_KEYS = Object.freeze([
  'cl_crosshairsize', 'cl_crosshairthickness', 'cl_crosshairgap',
  'cl_crosshair_outlinethickness', 'cl_crosshairusealpha', 'cl_crosshairalpha',
  'cl_crosshaircolor', 'cl_crosshairgap_useweaponvalue', 'cl_fixedcrosshairgap',
]);

export function isLegacyParams(p) {
  if (!p || typeof p !== 'object') return false;
  if ('cl_crosshair_length' in p || 'cl_crosshair_thickness' in p) return false;
  return LEGACY_KEYS.some((k) => k in p);
}
