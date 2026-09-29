// CS2-Crosshair-Renderer (System seit dem "Rush Hour"-Update 2026-09-22).
//
// Zwei Schichten, wie im Spiel:
//   1. Geometrie (CPU, csgo_crosshair.cpp): Cvars -> Liste von max. 16 Shapes
//      (Rect / Kreisring / Quad-Bogensegmente) mit Fuell- und Outline-Farbe.
//      -> buildShapes(). Formeln aus dem Ghidra-Decompilat von libclient.so,
//         siehe ~/projects/cs2-re/NOTES.md; per Screenshot zu verifizieren.
//   2. Pixel-Shader (csgo_crosshair.slang, aus SPIR-V rekonstruiert, 1:1 portiert):
//      pro Pixel Masken aller Shapes, Fill-/Outline-Auswahl nach maximalem Alpha,
//      Compositing Fill ueber Outline, Ausgabe premultiplied.
//      -> shadePixel().
//
// Gerendert wird per Canvas in echten Spielpixeln der simulierten Aufloesung
// (preview-settings: Default 1280x960, die Spielaufloesung des Streamers) und als
// <image> in das SVG gelegt, dessen viewBox 1 Einheit = 1 Spielpixel ist
// (Zoom = viewBox-Crop). Das Spiel skaliert die Cvar-Werte mit
// Hoehe / cl_crosshair_screen_height — die Vorschau tut dasselbe (scalePx).

import { onChange, getSettings, getResolution } from './preview-settings.js';
import { getBgPixels, onBgChange } from './bg.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const SCREEN_W = 1280;
export const SCREEN_H = 960;

const PI = Math.PI;
const HALF_PI = PI / 2;

// ---------------------------------------------------------------------------
// Shader-Port (exakt nach csgo_crosshair.slang)
// ---------------------------------------------------------------------------

// HLSL smoothstep, auch mit vertauschten Kanten (e0 > e1 -> fallende Flanke).
function smoothstep(e0, e1, x) {
  let t = (x - e0) / (e1 - e0);
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return t * t * (3 - 2 * t);
}
function lerp(a, b, t) { return a + (b - a) * t; }

// Winkelgewicht fuer die Half-Outline: 0 auf der oben-links-Haelfte, 1 auf
// der unten-rechts-Haelfte, weich in den Uebergangsquadranten.
function halfWeight(theta) {
  return Math.max(smoothstep(0, HALF_PI, theta), smoothstep(-HALF_PI, -PI, theta));
}

// Shape: { type: 0|1|2, a: [x,y,z,w], m1, ol: [x,y], fill: [r,g,b,a], outline: [r,g,b,a] }
//   type 0 Rect:   a = [minX, minY, maxX, maxY] (inklusiv, Integer-Pixel)
//   type 1 Ring:   a = [cx, cy, outerRadius, thickness]
//   type 2 Quad:   wie Ring, m1 = volle Winkelbreite der 4 Bogensegmente (rad)
//   ol = [outlineTopLeft, outlineBottomRight] in Pixeln
// Rueckgabe [outlineMask, fillMask] in 0..1
function shapeMask(s, px, py) {
  const a = s.a;
  if (s.type === 1) {
    const dx = px - a[0], dy = py - a[1];
    const theta = Math.atan2(dx, -dy);
    const inner = a[2] - a[3];
    const r = Math.hypot(dx, dy);
    const k = halfWeight(theta);
    const outerO = a[2] + lerp(s.ol[0], s.ol[1], k);
    const innerO = inner - lerp(s.ol[1], s.ol[0], k);
    return [
      smoothstep(outerO + 0.5, outerO - 0.5, r) * smoothstep(innerO - 0.5, innerO + 0.5, r),
      smoothstep(a[2] + 0.5, a[2] - 0.5, r) * smoothstep(inner - 0.5, inner + 0.5, r),
    ];
  }
  if (s.type === 2) {
    const dx = px - a[0], dy = py - a[1];
    const theta = Math.atan2(dx, -dy);
    // Winkelabstand zur Quadranten-Diagonale (45 Grad), 0..pi/4
    const ang = Math.abs((theta - Math.floor(theta * (2 / PI)) * HALF_PI) - PI / 4);
    const r = Math.hypot(dx, dy);
    const rc = Math.max(r, 1);
    const invR = 1 / rc;
    const hw = 0.5 * s.m1;
    const k = halfWeight(theta);
    const ol = lerp(s.ol[0], s.ol[1], k);
    const half = 0.5 / rc;
    const inner = a[2] - a[3];
    const outerO = a[2] + ol;
    const innerO = inner - lerp(s.ol[1], s.ol[0], k);
    const radialO = smoothstep(outerO + 0.5, outerO - 0.5, r) * smoothstep(innerO - 0.5, innerO + 0.5, r);
    const radialF = smoothstep(a[2] + 0.5, a[2] - 0.5, r) * smoothstep(inner - 0.5, inner + 0.5, r);
    const angO = smoothstep(hw + (ol + 0.5) * invR, hw + (ol - 0.5) * invR, ang);
    const angF = smoothstep(hw + half, hw - half, ang);
    return [radialO * angO, radialF * angF];
  }
  // Rect, harte Integer-Tests (kein Anti-Aliasing)
  const o = (px >= a[0] - s.ol[0] && py >= a[1] - s.ol[0] && px <= a[2] + s.ol[1] && py <= a[3] + s.ol[1]) ? 1 : 0;
  const f = (px >= a[0] && py >= a[1] && px <= a[2] && py <= a[3]) ? 1 : 0;
  return [o, f];
}

// Liefert premultiplied RGBA (0..1) fuer ein Pixel.
export function shadePixel(shapes, px, py, out) {
  let fr = 0, fg = 0, fb = 0, fa = 0;
  let orr = 0, og = 0, ob = 0, oa = 0;
  for (let i = 0; i < shapes.length; i++) {
    const s = shapes[i];
    const m = shapeMask(s, px, py);
    const fAlpha = m[1] * s.fill[3];
    if (fAlpha >= fa) { fr = s.fill[0]; fg = s.fill[1]; fb = s.fill[2]; fa = fAlpha; }
    const oAlpha = m[0] * s.outline[3];
    if (oAlpha >= oa) { orr = s.outline[0]; og = s.outline[1]; ob = s.outline[2]; oa = oAlpha; }
  }
  const oEff = (1 - fa) * oa;
  out[0] = lerp(orr * oEff, fr, fa);
  out[1] = lerp(og * oEff, fg, fa);
  out[2] = lerp(ob * oEff, fb, fa);
  out[3] = lerp(oEff, 1, fa);
  return out;
}

// ---------------------------------------------------------------------------
// Geometrie (CPU-Seite) — aus libclient.so (Build 25.09.2026) per Ghidra/Disassembly
// abgeleitet, siehe ~/projects/cs2-re/NOTES.md. Alle Cvars sind Integer-Pixel bei der
// Bezugshoehe cl_crosshair_screen_height; das Spiel skaliert sie beim Aufloesungs-
// wechsel auf die aktuelle Hoehe um (Rundung: siehe scalePx, per Screenshot zu belegen).
// ---------------------------------------------------------------------------

function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

// Umrechnung Bezugshoehe -> Bildschirmhoehe, exakt wie CCSGO_Crosshair (VMA 1befb70):
// factor = H / screen_height; v > 0 -> max(1, roundf(v * factor)); 0 bleibt 0.
// Gilt fuer gap, length, thickness, dynamic_spread_limit und dynamic_splitdist.
function roundHalfAway(x) { return x < 0 ? -Math.round(-x) : Math.round(x); }
export function scalePx(v, refH, screenH) {
  if (!(v > 0)) return 0;
  if (refH === screenH) return v;
  return Math.max(1, roundHalfAway(v * screenH / refH));
}

// Dicke -> (n, hi, lo, odd) wie im Spiel: n = round(t) >= 1, hi = (n+1)>>1, lo = n-hi.
function thick(t) {
  let n = Math.round(t);
  if (n < 1) n = 1;
  const hi = (n + 1) >> 1;
  const lo = n - hi;
  return { n, hi, lo, odd: hi !== lo };
}

// Outline-Ausdehnung [oben-links, unten-rechts] und ob die Outline sichtbar ist.
function outlineExt(mode) {
  if (mode === 1) return { ol: [1, 1], on: true };
  if (mode === 2) return { ol: [1, 0], on: true };
  return { ol: [0, 0], on: false };
}

// Dynamische Distanz (this+0xe0) aus dem Spread in Pixeln.
export function dynamicDistance(spreadPx, { spreadLimit, outlineMode, dot, thickness }) {
  const maxD = spreadLimit + 64;
  const knee = 0.75 * maxD;
  let s = spreadPx;
  if (s > knee) s = maxD - (maxD - knee) * Math.exp(-(s - knee) / (maxD - knee));
  s = Math.min(s, maxD);
  let minDist = outlineMode === 1 ? 2 : 1;
  if (dot) minDist += thickness;
  s = Math.max(s, minDist);
  return Math.trunc(s);
}

// buildShapes(params, screenH, screenW, opts)
//   opts.spreadPx: simulierter Waffen-Spread in Pixeln (nur Vorschau; 0 = Messer, Gewehr im Stand ~7 px bei 1080p)
//   opts.kick:     Legacy-Rueckstosswert (Style 5), 0..25, steigt je Schuss um 15, faellt 42/s
export function buildShapes(params, screenH = SCREEN_H, screenW = SCREEN_W, opts = {}) {
  const p = params || {};
  const style = clamp(Math.round(num(p.cl_crosshairstyle, 4)), 0, 8);
  const refH = Math.max(240, num(p.cl_crosshair_screen_height, 1080));
  const length = scalePx(clamp(num(p.cl_crosshair_length, 8), 0, 255), refH, screenH);
  const t = scalePx(clamp(num(p.cl_crosshair_thickness, 2), 0, 31), refH, screenH);
  const gap = scalePx(clamp(num(p.cl_crosshair_gap, 4), 0, 128), refH, screenH);
  const spreadLimit = scalePx(clamp(num(p.cl_crosshair_dynamic_spread_limit, 255), 0, 255), refH, screenH);
  const dot = num(p.cl_crosshairdot, 0) === 1;
  const tStyle = num(p.cl_crosshair_t, 0) === 1;
  const outlineMode = clamp(Math.round(num(p.cl_crosshair_drawoutline, 1)), 0, 2);
  const { ol, on: outlineOn } = outlineExt(outlineMode);
  const spreadPx = Math.max(0, num(opts.spreadPx, 0));

  const alpha = clamp(num(p.cl_crosshaircolor_a, 255), 0, 255) / 255;
  const fill = [
    clamp(num(p.cl_crosshaircolor_r, 0), 0, 255) / 255,
    clamp(num(p.cl_crosshaircolor_g, 255), 0, 255) / 255,
    clamp(num(p.cl_crosshaircolor_b, 0), 0, 255) / 255,
    alpha,
  ];
  const outline = [0, 0, 0, outlineOn ? alpha : 0];

  const cx = Math.trunc(screenW / 2);
  const cy = Math.trunc(screenH / 2);
  const shapes = [];
  // Rect-Helper des Spiels: x1/y1 exklusiv -> max = x1-1 (inklusiv im Shader).
  const rect = (x0, y0, x1, y1) => shapes.push({ type: 0, a: [x0, y0, x1 - 1, y1 - 1], m1: 0, ol, fill, outline });
  const ring = (type, c, outer, w, m1) => shapes.push({ type, a: [cx - c - 0.5, cy - c - 0.5, outer, w], m1, ol, fill, outline });

  const crossWith = (dist, len, f, o) => {
    if (len <= 0 || t <= 0) return;
    const { hi, lo, odd } = thick(t);
    const adj = odd ? -1 : 0;
    const L = Math.floor(cx - dist);
    const R = Math.ceil(cx + dist) + adj;
    const T = Math.ceil(cy + dist) + adj;
    const r2 = (x0, y0, x1, y1) => shapes.push({ type: 0, a: [x0, y0, x1 - 1, y1 - 1], m1: 0, ol, fill: f, outline: o });
    r2(L - len, cy - hi, L, cy + lo);
    r2(R, cy - hi, R + len, cy + lo);
    r2(cx - hi, T, cx + lo, T + len);
    if (!tStyle) {
      const y0 = Math.floor(cy - dist - len);
      r2(cx - hi, y0, cx + lo, y0 + len);
    }
  };
  const cross = (dist) => crossWith(dist, length, fill, outline);
  const circle = (r) => {
    if (r < 0 || t <= 0) return;
    const { odd } = thick(t);
    ring(1, odd ? 0.5 : 0, r + t, Math.max(1, t - 1), 0);
  };
  const drawDot = () => {
    if (t <= 0) return;
    const { hi, lo } = thick(t);
    shapes.push({ type: 0, a: [cx - hi, cy - hi, cx + lo - 1, cy + lo - 1], m1: 0, ol, fill, outline });
  };

  const e0 = dynamicDistance(spreadPx, { spreadLimit, outlineMode, dot, thickness: t });

  if (dot || style === 6) drawDot();

  switch (style) {
    case 0: cross(e0); break;
    case 1: circle(e0); break;
    case 2: {
      // Classic (VMA 1bf2f10): Spread in 480er-Einheiten (spread01), Pixel = roundf(H/480 * spread01).
      // Split, sobald spread01 > splitdist: innere Balken bei splitPx + gap mit alpha*innermod,
      // aeussere bei spreadPx + gap + innerLen mit alpha*outermod.
      const splitdist = clamp(num(p.cl_crosshair_dynamic_splitdist, 3), 0, 127);
      const inner = clamp(num(p.cl_crosshair_dynamic_splitalpha_innermod, 0), 0, 1);
      const outer = clamp(num(p.cl_crosshair_dynamic_splitalpha_outermod, 1), 0.3, 1);
      const ratio = clamp(num(p.cl_crosshair_dynamic_maxdist_splitratio, 1), 0, 1);
      const spread01 = spreadPx * 480 / screenH;
      const sPx = roundHalfAway(screenH / 480 * spread01);
      const splitPx = roundHalfAway(screenH / 480 * Math.min(splitdist, spread01));
      if (sPx <= 0) { cross(gap); break; }              // stehend; Laufen/Ducken nur im Spiel (+2/-2/+4)
      if (spread01 > splitdist) {
        const innerLen = Math.ceil((1 - ratio) * length);
        const outerLen = Math.floor(ratio * length);
        const a255 = Math.round(alpha * 255);
        const withAlpha = (mod) => { const a = Math.trunc(a255 * mod) / 255; return { fill: [fill[0], fill[1], fill[2], a], outline: [0, 0, 0, outlineOn ? a : 0] }; };
        const o = withAlpha(outer), i = withAlpha(inner);
        crossWith(sPx + gap + innerLen, outerLen, o.fill, o.outline);
        crossWith(splitPx + gap, innerLen, i.fill, i.outline);
      } else {
        cross(sPx + gap);
      }
      break;
    }
    case 5: {
      // Legacy (VMA 1bf3240): dist = roundf(gap + H/1200 * kick), kick += 15 je Schuss, max 25, -42/s.
      const kick = Math.max(0, Math.min(25, num(opts.kick, 0)));
      cross(roundHalfAway(gap + screenH / 1200 * kick));
      break;
    }
    case 3: circle(Math.max(1, gap)); break;
    case 4: cross(gap); break;
    case 7: {
      cross(gap);
      if (spreadPx > 0 && t > 0) {
        const { odd } = thick(t);
        if (spreadPx < 100 && spreadPx <= 10) {
          ring(1, (odd && t >= 1) ? 0.5 : 0, e0 + Math.max(1, t - 1), Math.max(1, t - 1), 0);
        } else {
          ring(2, (odd && t >= 1) ? 0.5 : 0, e0 + t, t, 45 * Math.PI / 180);
        }
      }
      break;
    }
    case 8: {
      if (t <= 0) break;
      const { odd } = thick(t);
      const adj = (odd && dot) ? -1 : 0;
      const xr = Math.floor(cx + gap), x0 = Math.floor(cx - gap - t + adj);
      const yb = Math.floor(cy + gap), y0 = Math.floor(cy - gap - t + adj);
      rect(x0, y0, xr, y0 + t);
      rect(x0, yb, xr, yb + t);
      rect(x0, y0, x0 + t, yb + t);
      rect(xr, y0, xr + t, yb + t);
      break;
    }
    default: break;
  }
  return shapes.slice(0, 16);
}

// ---------------------------------------------------------------------------
// Rasterisierung
// ---------------------------------------------------------------------------

function shapeBounds(s) {
  const e = Math.max(s.ol[0], s.ol[1]) + 2;
  if (s.type === 0) return [s.a[0] - e, s.a[1] - e, s.a[2] + e, s.a[3] + e];
  const r = s.a[2] + e;
  return [s.a[0] - r, s.a[1] - r, s.a[0] + r, s.a[1] + r];
}

// sRGB <-> linear (Framebuffer des Spiels ist sRGB, Blending in linearem Licht).
const S2L = new Float32Array(256);
for (let i = 0; i < 256; i++) { const v = i / 255; S2L[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
function l2s(l) {
  if (l <= 0) return 0; if (l >= 1) return 255;
  return Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055));
}

// Rendert die Shapes in ein Canvas (nur die Bounding-Box) und liefert
// { canvas, x, y, w, h } in Bildschirmpixeln.
//
// Blend-Modell des Spiels (per Screenshot belegt, data/calibration-v2): der Shader
// liefert premultiplied rgb_pm und a; der Blend-State ist SRC_ALPHA / ONE_MINUS_SRC_ALPHA
// auf einem sRGB-Framebuffer, also in linearem Licht:
//   out_lin = rgb_pm * a + dst_lin * (1 - a),  rgb_pm = srgb2lin(farbe) * a
// Mit bekanntem Hintergrund (bgPixels, 1280x960 ImageData) wird exakt so gemischt und
// opak ausgegeben; ohne Hintergrund als Naeherung straight-alpha (rgb_pm, a).
export function rasterize(shapes, screenW = SCREEN_W, screenH = SCREEN_H, bgPixels = null) {
  if (!shapes.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of shapes) {
    const b = shapeBounds(s);
    x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]);
    x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]);
  }
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
  x1 = Math.min(screenW - 1, Math.ceil(x1)); y1 = Math.min(screenH - 1, Math.ceil(y1));
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (w <= 0 || h <= 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const useBg = bgPixels && bgPixels.width === screenW && bgPixels.height === screenH;
  const bg = useBg ? bgPixels.data : null;
  // Die Cvar-Farbe ist sRGB und wird vom Spiel vor dem Mischen linearisiert (Fall 17/18).
  // Mit Hintergrund rechnen wir komplett in linearem Licht, sonst bleibt alles sRGB.
  const lin = (v) => S2L[Math.round(clamp(v, 0, 1) * 255)];
  if (useBg) shapes = shapes.map((sh) => ({ ...sh, fill: [lin(sh.fill[0]), lin(sh.fill[1]), lin(sh.fill[2]), sh.fill[3]], outline: [lin(sh.outline[0]), lin(sh.outline[1]), lin(sh.outline[2]), sh.outline[3]] }));
  const px = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x0 + x, sy = y0 + y;
      shadePixel(shapes, sx, sy, px);
      const a = px[3];
      if (a <= 0) continue;
      const i = (y * w + x) * 4;
      if (useBg) {
        const j = (sy * screenW + sx) * 4;
        d[i]     = l2s(px[0] * a + S2L[bg[j]]     * (1 - a));
        d[i + 1] = l2s(px[1] * a + S2L[bg[j + 1]] * (1 - a));
        d[i + 2] = l2s(px[2] * a + S2L[bg[j + 2]] * (1 - a));
        d[i + 3] = 255;
      } else {
        d[i] = Math.round(clamp(px[0], 0, 1) * 255);
        d[i + 1] = Math.round(clamp(px[1], 0, 1) * 255);
        d[i + 2] = Math.round(clamp(px[2], 0, 1) * 255);
        d[i + 3] = Math.round(a * 255);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, x: x0, y: y0, w, h };
}

// ---------------------------------------------------------------------------
// SVG-Einbettung (API unveraendert: renderCrosshair / ensureSvg / registerForRerender)
// ---------------------------------------------------------------------------

function clearChildren(el) { while (el.firstChild) el.removeChild(el.firstChild); }

export function renderCrosshair(svg, params, opts = {}) {
  clearChildren(svg);
  const settings = getSettings();
  const res = getResolution();
  const W = res.w, H = res.h;
  const zoom = (Number.isFinite(opts.zoom) && opts.zoom > 0) ? opts.zoom : settings.zoom;
  const vbW = W / zoom, vbH = H / zoom;
  svg.setAttribute('viewBox', `${W / 2 - vbW / 2} ${H / 2 - vbH / 2} ${vbW} ${vbH}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  // Grosse Vorschau-Container folgen dem Seitenverhaeltnis der simulierten Aufloesung.
  const host = svg.parentElement;
  if (host && host.classList.contains('preview')) host.style.aspectRatio = `${W} / ${H}`;
  if (!params) return;

  const spreadPx = Number.isFinite(opts.spreadPx) ? opts.spreadPx : settings.spreadPx;
  const kick = Number.isFinite(opts.kick) ? opts.kick : (settings.kick || 0);
  const shapes = buildShapes(params, H, W, { spreadPx, kick });
  const r = rasterize(shapes, W, H, getBgPixels(host, W, H));
  if (!r) return;
  const img = document.createElementNS(SVG_NS, 'image');
  img.setAttribute('x', r.x);
  img.setAttribute('y', r.y);
  img.setAttribute('width', r.w);
  img.setAttribute('height', r.h);
  img.setAttribute('href', r.canvas.toDataURL('image/png'));
  img.setAttribute('style', 'image-rendering: pixelated; image-rendering: crisp-edges;');
  svg.appendChild(img);
}

export function ensureSvg(host) {
  let svg = host.querySelector('svg');
  if (!svg) {
    svg = document.createElementNS(SVG_NS, 'svg');
    host.appendChild(svg);
  }
  return svg;
}

const registered = new Set();
export function registerForRerender(svg, getParams) { registered.add({ svg, getParams }); }

function rerenderAll() {
  for (const entry of registered) {
    try { renderCrosshair(entry.svg, entry.getParams()); } catch (_e) { /* ignore */ }
  }
}
onChange(rerenderAll);
onBgChange(rerenderAll);
