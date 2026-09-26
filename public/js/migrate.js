// Migration alter Crosshair-Params (Cvar-Satz vor 2026-09-22) auf das neue Pixel-System.
//
// Es gibt KEINE offizielle Umrechnung — der CS2-Client lehnt alte Share-Codes ab
// ("Invalid or old crosshair code"). Die Formel hier bildet nach, was der alte Renderer
// (Source-Engine-Logik, siehe preview.js vor dem Umbau) bei Bildschirmhoehe H in Pixeln
// gezeichnet hat, und uebertraegt diese Pixel 1:1 in die neuen Cvars mit
// cl_crosshair_screen_height = H.
//
// Altes Rendering (validiert per Screenshot-Kalibrierung, Style 4):
//   barLen   = bround(size * H / 480)
//   barThick = max(1, bround(thickness * H / 480))
//   dist     = 4 + gap                      (Pixel, nicht skaliert, auch negativ)
//   innerer Balkenrand = dist + floor(barThick / 2) Pixel vom Zentrum
//
// Neues System: length/thickness = Pixel; gap = Offset auf den Abstand Zentrum->Balken
// (Semantik der Gap-Basis: siehe GAP_INNER_EDGE_OFFSET, aus Ghidra/Screenshots zu belegen).
// Negative Abstaende gibt es nicht mehr -> auf 0 geclampt.

import { normalizeParams } from './cvars.js';

// Abstand Zentrum -> innerer Balkenrand im neuen System = gap + GAP_INNER_EDGE_OFFSET(thickness).
// Hypothese (Community: "inner edge sits gap px from centre"): 0. Wird nach der
// Ghidra-Analyse ggf. angepasst.
export function gapInnerEdgeOffset(_thicknessPx) {
  return 0;
}

// Banker's rounding wie die Source-Engine (YRES).
function bround(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}

const STYLE_MAP = { 0: 0, 1: 4, 2: 2, 3: 0, 4: 4, 5: 5 };

// Alte cl_crosshaircolor-Presets (0..4); 5 = custom RGB.
const COLOR_PRESETS = {
  0: [250, 50, 50], 1: [50, 250, 50], 2: [250, 250, 50], 3: [50, 50, 250], 4: [50, 250, 250],
};

const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

// migrateLegacyParams(old, { screenHeight }) -> neue Params (normalisiert, nie null)
export function migrateLegacyParams(old, { screenHeight = 1080 } = {}) {
  const o = old || {};
  const H = screenHeight;

  const size = Math.max(0, num(o.cl_crosshairsize, 5));
  const thick = Math.max(0, num(o.cl_crosshairthickness, 0.5));
  const gapOld = num(o.cl_crosshairgap, 0);

  const barLen = Math.max(0, bround(size * H / 480));
  const barThick = Math.max(1, bround(thick * H / 480));
  const innerEdge = Math.trunc(4 + gapOld) + Math.floor(barThick / 2);
  const gapNew = Math.max(0, innerEdge - gapInnerEdgeOffset(barThick));

  let r = num(o.cl_crosshaircolor_r, 0), g = num(o.cl_crosshaircolor_g, 255), b = num(o.cl_crosshaircolor_b, 0);
  const colorIdx = num(o.cl_crosshaircolor, 5);
  if (COLOR_PRESETS[colorIdx]) [r, g, b] = COLOR_PRESETS[colorIdx];

  const useAlpha = num(o.cl_crosshairusealpha, 0) ? 1 : 0;
  const alpha = useAlpha ? num(o.cl_crosshairalpha, 255) : 255;

  const drawOutline = num(o.cl_crosshair_drawoutline, 0) ? 1 : 0;
  const outlineT = num(o.cl_crosshair_outlinethickness, 1);
  const outlineMode = drawOutline && outlineT > 0 ? 1 : 0;

  const styleOld = num(o.cl_crosshairstyle, 4);
  const style = STYLE_MAP[styleOld] ?? 4;

  const sd = o.cl_crosshair_dynamic_splitdist;

  return normalizeParams({
    cl_crosshairstyle: style,
    cl_crosshair_length: barLen,
    cl_crosshair_thickness: barThick,
    cl_crosshair_gap: gapNew,
    cl_crosshairdot: num(o.cl_crosshairdot, 0) ? 1 : 0,
    cl_crosshair_t: num(o.cl_crosshair_t, 0) ? 1 : 0,
    cl_crosshair_recoil: num(o.cl_crosshair_recoil, 0) ? 1 : 0,
    cl_crosshair_drawoutline: outlineMode,
    cl_crosshaircolor_r: r,
    cl_crosshaircolor_g: g,
    cl_crosshaircolor_b: b,
    cl_crosshaircolor_a: alpha,
    cl_crosshair_dynamic_spread_limit: 255,
    cl_crosshair_dynamic_splitdist: (sd === null || sd === undefined) ? 3 : sd,
    cl_crosshair_dynamic_splitalpha_innermod: num(o.cl_crosshair_dynamic_splitalpha_innermod, 0),
    cl_crosshair_dynamic_splitalpha_outermod: num(o.cl_crosshair_dynamic_splitalpha_outermod, 1),
    cl_crosshair_dynamic_maxdist_splitratio: num(o.cl_crosshair_dynamic_maxdist_splitratio, 1),
    cl_crosshair_screen_height: H,
  });
}
