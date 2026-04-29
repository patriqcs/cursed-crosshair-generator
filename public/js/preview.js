// CS2-style crosshair SVG renderer.
//
// Implementiert die CS2-Source-Engine-Renderlogik 1:1. Validiert gegen
// 8 Calibration-Screenshots in 1440x1080 native (siehe data/calibration/).
//
// Kernformel (Style 4, statisches Crosshair):
//   YRES(x)        = x * SCREEN_H / 480
//   iBarSize       = round-half-to-even(YRES(size))
//   iBarThickness  = max(1, round-half-to-even(YRES(thickness)))
//   iCrosshairDist = 4 + gap                       // Pixel, NICHT skaliert
//
// Jede Linie ist ein vgui-Rect [(x1,y1), (x2,y2)] mit Pixelkoordinaten,
// gefuellte Pixel x in [x1, x2), y in [y1, y2). Outline expandiert das
// Rect um cl_crosshair_outlinethickness Pixel (auch nicht skaliert) in
// alle 4 Richtungen, gezeichnet HINTER der Farbfuellung.
//
// SVG-viewBox = 0 0 1440 1080 — 1 SVG-Einheit = 1 CS2-Pixel bei 1080p,
// damit Overlays auf 1440x1080-Screenshots pixelgenau passen.

import { onChange, getSettings } from './preview-settings.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SCREEN_W = 1440;
const SCREEN_H = 1080;
const CENTER_X = SCREEN_W / 2;   // 720
const CENTER_Y = SCREEN_H / 2;   // 540
const REF_H = 480;               // Source-Engine Referenzhoehe

function YRES(x) {
  return (x * SCREEN_H) / REF_H;
}

// Banker's rounding (round half to even). CS2 / Source Engine matcht dieses
// Verhalten: YRES(10) = 22.5 -> 22, YRES(6) = 13.5 -> 14. Validiert gegen
// alle 8 Calibration-Screenshots.
function bround(x) {
  if (!Number.isFinite(x)) return 0;
  const f = Math.floor(x);
  const diff = x - f;
  if (Math.abs(diff - 0.5) < 1e-9) {
    return (f % 2 === 0) ? f : f + 1;
  }
  return Math.round(x);
}

function svgEl(name, attrs) {
  const el = document.createElementNS(SVG_NS, name);
  if (attrs) {
    for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k]);
  }
  return el;
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function clamp255(v) {
  v = Number(v);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(255, Math.round(v)));
}

// vgui::DrawFilledRect-Aequivalent: rect mit oberer-linker-Ecke (x1,y1) und
// gefuellten Pixeln in [x1, x2) x [y1, y2). Wir konvertieren zu SVG-Rect mit
// width = x2-x1, height = y2-y1.
//
// Kein shape-rendering: crispEdges — bei stark verkleinerten Previews
// (z.B. 80px-Thumbnails) wuerden sub-pixel-duenne Linien (SPAGHETTI mit
// thickness=0.1) sonst komplett verschwinden, weil der Browser auf 0px
// Hoehe rundet. Mit dem Default (auto) werden sie semi-transparent
// gerendert und bleiben sichtbar.
function appendRect(svg, x1, y1, x2, y2, fill, opacity) {
  const w = x2 - x1;
  const h = y2 - y1;
  if (w <= 0 || h <= 0) return;
  svg.appendChild(svgEl('rect', {
    x: x1, y: y1, width: w, height: h,
    fill, opacity,
  }));
}

// Berechnet die 4 Linien-Rects + Dot-Rect nach CS2-Formel.
// Gibt Array von { x1, y1, x2, y2 } zurueck (vgui-Rects).
function computeRects(params) {
  const size = Math.max(0, Number(params.cl_crosshairsize) || 0);
  const thick = Math.max(0, Number(params.cl_crosshairthickness) || 0);
  const gap = Number.isFinite(params.cl_crosshairgap) ? Number(params.cl_crosshairgap) : 0;
  const showT = (params.cl_crosshair_t ?? 0) === 1;
  const dotEnabled = (params.cl_crosshairdot ?? 0) === 1;

  const iBarSize = Math.max(0, bround(YRES(size)));
  const iBarThickness = Math.max(1, bround(YRES(thick)));
  const fGoal = 4;
  const iCrosshairDistance = fGoal + gap;

  const halfT = Math.floor(iBarThickness / 2);

  const rects = [];

  // Horizontal lines (left + right)
  if (iBarSize > 0 && iBarThickness > 0) {
    const iInnerLeft = CENTER_X - iCrosshairDistance - halfT;
    const iInnerRight = iInnerLeft + 2 * iCrosshairDistance + iBarThickness;
    const iOuterLeft = iInnerLeft - iBarSize;
    const iOuterRight = iInnerRight + iBarSize;
    const y0 = CENTER_Y - halfT;
    const y1 = y0 + iBarThickness;
    rects.push({ kind: 'left',  x1: iOuterLeft,  y1: y0, x2: iInnerLeft,  y2: y1 });
    rects.push({ kind: 'right', x1: iInnerRight, y1: y0, x2: iOuterRight, y2: y1 });

    // Vertical lines (top + bottom). Top-Pip entfaellt bei T-Style komplett
    // (weder Color noch Outline). Das "Rechteck in der Mitte" entsteht bei
    // negativem Gap automatisch durch die Ueberlappung der left/right-
    // Outline-Rects — eigene Top-Geometrie wuerde dort nur stoeren.
    const iInnerTop = CENTER_Y - iCrosshairDistance - halfT;
    const iInnerBottom = iInnerTop + 2 * iCrosshairDistance + iBarThickness;
    const iOuterTop = iInnerTop - iBarSize;
    const iOuterBottom = iInnerBottom + iBarSize;
    const x0 = CENTER_X - halfT;
    const x1 = x0 + iBarThickness;
    if (!showT) {
      rects.push({ kind: 'top', x1: x0, y1: iOuterTop, x2: x1, y2: iInnerTop });
    }
    rects.push({ kind: 'bottom', x1: x0, y1: iInnerBottom, x2: x1, y2: iOuterBottom });
  }

  // Dot — quadratisch iBarThickness x iBarThickness, zentriert auf (cx, cy)
  // mit gleicher halfT-Logik wie die Linien (Top-Left bei (cx-halfT, cy-halfT)).
  if (dotEnabled && iBarThickness > 0) {
    const dx0 = CENTER_X - halfT;
    const dy0 = CENTER_Y - halfT;
    rects.push({
      kind: 'dot',
      x1: dx0, y1: dy0,
      x2: dx0 + iBarThickness, y2: dy0 + iBarThickness,
    });
  }

  return rects;
}

// renderCrosshair(svg, params, opts?)
//   opts.zoom — viewBox-Zoom auf das Zentrum (cropped frame, gleiche
//     Render-Mathematik). Default = global aus preview-settings. Mit
//     opts.zoom: 1 erzwingt der Aufrufer den vollen 1440x1080-Frame
//     unabhaengig vom globalen Zoom.
export function renderCrosshair(svg, params, opts = {}) {
  clearChildren(svg);

  const zoom = (Number.isFinite(opts.zoom) && opts.zoom > 0)
    ? opts.zoom
    : getSettings().zoom;
  const vbW = SCREEN_W / zoom;
  const vbH = SCREEN_H / zoom;
  const vbX = CENTER_X - vbW / 2;
  const vbY = CENTER_Y - vbH / 2;
  svg.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  if (!params) return;

  const dotEnabled = (params.cl_crosshairdot ?? 0) === 1;
  const sizeRaw = Number(params.cl_crosshairsize);
  if (Number.isFinite(sizeRaw) && sizeRaw <= 0 && !dotEnabled) return;

  const r = clamp255(params.cl_crosshaircolor_r ?? 0);
  const g = clamp255(params.cl_crosshaircolor_g ?? 255);
  const b = clamp255(params.cl_crosshaircolor_b ?? 0);
  const useAlpha = (params.cl_crosshairusealpha ?? 0) === 1;
  const alpha = clamp255(params.cl_crosshairalpha ?? 255);
  const opacity = useAlpha ? alpha / 255 : 1;
  const fill = `rgb(${r}, ${g}, ${b})`;

  const drawOutline = (params.cl_crosshair_drawoutline ?? 0) === 1;
  // Outline-Thickness ist in Pixeln, NICHT YRES-skaliert. Validiert via
  // test5 (ot=2 -> 2px Expansion) und test7 (ot=1 -> 1px Expansion).
  const tRaw = Number(params.cl_crosshair_outlinethickness) || 0;
  const outlineT = drawOutline ? Math.max(0, bround(tRaw)) : 0;

  const rects = computeRects(params);

  // Pro Linie sequenziell: voller Outline-Rect, dann Color-Rect direkt darauf.
  // Effekt:
  //   - Innerhalb einer Linie: Color liegt auf eigener Outline -> nur der
  //     Outline-Rand bleibt um die Farbe sichtbar.
  //   - Zwischen Linien: spaeter gezeichnete Outlines liegen ueber den
  //     Farben frueherer Linien -> bei ueberlappenden Linien (negativer
  //     Gap) ueberdeckt die Outline der spaeteren Linie die Farbe der
  //     frueheren.
  for (const r2 of rects) {
    if (outlineT > 0) {
      appendRect(
        svg,
        r2.x1 - outlineT, r2.y1 - outlineT,
        r2.x2 + outlineT, r2.y2 + outlineT,
        '#000', opacity,
      );
    }
    appendRect(svg, r2.x1, r2.y1, r2.x2, r2.y2, fill, opacity);
  }
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

export function registerForRerender(svg, getParams) {
  registered.add({ svg, getParams });
}

onChange(() => {
  for (const entry of registered) {
    try { renderCrosshair(entry.svg, entry.getParams()); } catch (_e) { /* ignore */ }
  }
});
