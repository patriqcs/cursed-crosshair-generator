'use strict';

// Geometrie-Tests fuer den Renderer (public/js/preview.js, Browser-ESM, in Node importierbar).
// Erwartungswerte von Hand aus dem Decompilat von libclient.so Build 2000922 (2026-09-30)
// abgeleitet, siehe ~/projects/cs2-re/NOTES.md — nicht aus der Implementierung kopiert.

const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../public/js/preview.js');

const W = 1920, H = 1080, CX = 960, CY = 540;
const BASE = Object.freeze({
  cl_crosshairstyle: 4, cl_crosshair_length: 8, cl_crosshair_thickness: 2, cl_crosshair_gap: 4,
  cl_crosshairdot: 0, cl_crosshair_t: 0, cl_crosshair_recoil: 0, cl_crosshair_drawoutline: 1,
  cl_crosshaircolor_r: 255, cl_crosshaircolor_g: 0, cl_crosshaircolor_b: 255, cl_crosshaircolor_a: 255,
  cl_crosshairoutline_r: 0, cl_crosshairoutline_g: 0, cl_crosshairoutline_b: 0, cl_crosshairoutline_a: 255,
  cl_crosshair_dynamic_spread_limit: 255, cl_crosshair_dynamic_splitdist: 3,
  cl_crosshair_dynamic_splitalpha_innermod: 0, cl_crosshair_dynamic_splitalpha_outermod: 1,
  cl_crosshair_dynamic_maxdist_splitratio: 1, cl_crosshair_screen_height: 1080,
});
const geo = (shapes) => shapes.map((s) => ({ type: s.type, a: s.a, m1: s.m1, ol: s.ol }));
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('Static Quadrant (style 9): one arc shape, radius from gap, width from quadrant size', async () => {
  const { buildShapes } = await load();
  const s = buildShapes({ ...BASE, cl_crosshairstyle: 9, cl_crosshair_thickness: 4, cl_crosshair_gap: 10,
    cl_crosshair_dynamic_maxdist_splitratio: 0.5 }, H, W);
  assert.equal(s.length, 1);
  assert.equal(s[0].type, 2);
  assert.deepEqual(s[0].a, [CX - 0.5, CY - 0.5, 14, 4]); // Aussenradius gap + t, Ringdicke t
  close(s[0].m1, Math.PI / 4);                            // 0.5 * 90 Grad
  assert.deepEqual(s[0].ol, [1, 1]);
});

test('Static Quadrant: odd thickness shifts the centre by half a pixel, size 1 closes the ring', async () => {
  const { buildShapes } = await load();
  const s = buildShapes({ ...BASE, cl_crosshairstyle: 9, cl_crosshair_thickness: 3, cl_crosshair_gap: 6 }, H, W);
  assert.deepEqual(s[0].a, [CX - 1, CY - 1, 9, 3]);
  close(s[0].m1, Math.PI / 2);
});

test('Static Quadrant: gap below 1 (also negative) is drawn as 1, thickness 0 still emits the shape, dot is separate', async () => {
  const { buildShapes } = await load();
  for (const gap of [0, -5, -3840]) {
    const s = buildShapes({ ...BASE, cl_crosshairstyle: 9, cl_crosshair_thickness: 2, cl_crosshair_gap: gap }, H, W);
    assert.deepEqual(s[0].a, [CX - 0.5, CY - 0.5, 3, 2]);
  }
  const zero = buildShapes({ ...BASE, cl_crosshairstyle: 9, cl_crosshair_thickness: 0, cl_crosshair_gap: 7 }, H, W);
  assert.equal(zero.length, 1);
  assert.deepEqual(zero[0].a, [CX - 0.5, CY - 0.5, 7, 0]);
  const dot = buildShapes({ ...BASE, cl_crosshairstyle: 9, cl_crosshairdot: 1 }, H, W);
  assert.deepEqual(dot.map((x) => x.type), [0, 2]);
});

test('outline color and alpha come from cl_crosshairoutline_*, off means fully transparent', async () => {
  const { buildShapes } = await load();
  const p = { ...BASE, cl_crosshairoutline_r: 51, cl_crosshairoutline_g: 102, cl_crosshairoutline_b: 255, cl_crosshairoutline_a: 102,
    cl_crosshaircolor_a: 255 };
  for (const sh of buildShapes(p, H, W)) {
    assert.deepEqual(sh.outline, [0.2, 0.4, 1, 0.4]);
    assert.deepEqual(sh.fill, [1, 0, 1, 1]);
    assert.deepEqual(sh.ol, [1, 1]);
  }
  for (const sh of buildShapes({ ...p, cl_crosshair_drawoutline: 2 }, H, W)) {
    assert.deepEqual(sh.outline, [0.2, 0.4, 1, 0.4]);
    assert.deepEqual(sh.ol, [1, 0]); // Half Outline: nur oben/links
  }
  for (const sh of buildShapes({ ...p, cl_crosshair_drawoutline: 0 }, H, W)) {
    assert.deepEqual(sh.outline, [0, 0, 0, 0]);
    assert.deepEqual(sh.ol, [0, 0]);
  }
});

test('negative gap draws like gap 0 for the static cross, square, legacy and quadrant-cross styles', async () => {
  const { buildShapes } = await load();
  for (const style of [4, 5, 7, 8]) {
    const zero = geo(buildShapes({ ...BASE, cl_crosshairstyle: style, cl_crosshair_gap: 0 }, H, W, { spreadPx: 0 }));
    for (const gap of [-1, -10, -3840]) {
      const neg = geo(buildShapes({ ...BASE, cl_crosshairstyle: style, cl_crosshair_gap: gap }, H, W, { spreadPx: 0 }));
      assert.deepEqual(neg, zero, `style ${style} gap ${gap}`);
    }
  }
  // Static Circle: Radius max(1, gap)
  const one = geo(buildShapes({ ...BASE, cl_crosshairstyle: 3, cl_crosshair_gap: 1 }, H, W));
  assert.deepEqual(geo(buildShapes({ ...BASE, cl_crosshairstyle: 3, cl_crosshair_gap: -20 }, H, W)), one);
});

test('static cross geometry is unchanged (game default: t 2, gap 4, len 8)', async () => {
  const { buildShapes } = await load();
  const s = buildShapes({ ...BASE }, H, W);
  assert.deepEqual(s.map((x) => x.a), [
    [948, 539, 955, 540],   // links  [L-len, cy-hi] .. [L, cy+lo) inklusiv
    [964, 539, 971, 540],   // rechts
    [959, 544, 960, 551],   // unten
    [959, 528, 960, 535],   // oben
  ]);
});

test('Classic (style 2): negative gap shortens the spread distance but never crosses the centre', async () => {
  const { buildShapes } = await load();
  // splitdist 127 -> kein Split. Spread 20 px bei 1080p; dist = spreadPx + gap.
  const classic = (gap, spreadPx) => geo(buildShapes({ ...BASE, cl_crosshairstyle: 2, cl_crosshair_gap: gap,
    cl_crosshair_dynamic_splitdist: 127 }, H, W, { spreadPx }));
  const staticCross = (gap) => geo(buildShapes({ ...BASE, cl_crosshairstyle: 4, cl_crosshair_gap: gap }, H, W));
  assert.deepEqual(classic(-10, 20), staticCross(10));
  assert.deepEqual(classic(4, 20), staticCross(24));
  assert.deepEqual(classic(-10, 5), staticCross(0));   // 5 - 10 < 0 -> 0
  assert.deepEqual(classic(-10, 0), staticCross(0));   // Ruhe: trunc(gap + 4 - 4) = -10 -> 0
});

test('Classic split: inner and outer bars scale fill AND outline alpha with trunc(alpha * mod)', async () => {
  const { buildShapes } = await load();
  const s = buildShapes({ ...BASE, cl_crosshairstyle: 2, cl_crosshair_length: 10, cl_crosshair_gap: -2,
    cl_crosshair_dynamic_splitdist: 3, cl_crosshair_dynamic_splitalpha_innermod: 0.37,
    cl_crosshair_dynamic_splitalpha_outermod: 0.83, cl_crosshair_dynamic_maxdist_splitratio: 0.29,
    cl_crosshaircolor_a: 200, cl_crosshairoutline_a: 100 }, H, W, { spreadPx: 45 });
  // spread01 = 20 > splitdist 3; innerLen = ceil(0.71 * 10) = 8, outerLen = floor(2.9) = 2
  assert.equal(s.length, 8);
  const outer = s.slice(0, 4), inner = s.slice(4);
  for (const sh of outer) { close(sh.fill[3], Math.trunc(200 * 0.83) / 255); close(sh.outline[3], Math.trunc(100 * 0.83) / 255); }
  for (const sh of inner) { close(sh.fill[3], Math.trunc(200 * 0.37) / 255); close(sh.outline[3], Math.trunc(100 * 0.37) / 255); }
  // aeusserer linker Balken: dist = 45 - 2 + 8 = 51, Laenge 2 -> x 907..908
  assert.deepEqual(outer[0].a, [CX - 51 - 2, 539, CX - 51 - 1, 540]);
  // innerer linker Balken: splitPx = round(1080/480 * 3) = 7, dist = 7 - 2 = 5, Laenge 8 -> x 947..954
  assert.deepEqual(inner[0].a, [CX - 5 - 8, 539, CX - 5 - 1, 540]);
});

test('dynamic distance: floor is the dot size only (no outline term any more)', async () => {
  const { dynamicDistance, buildShapes } = await load();
  assert.equal(dynamicDistance(0, { spreadLimit: 255, dot: false, thickness: 2 }), 0);
  assert.equal(dynamicDistance(0, { spreadLimit: 255, dot: true, thickness: 3 }), 3);
  assert.equal(dynamicDistance(7.9, { spreadLimit: 255, dot: false, thickness: 2 }), 7);
  assert.equal(dynamicDistance(10000, { spreadLimit: 255, dot: false, thickness: 2 }), 319);
  // Dynamic Cross ohne Spread = Static Cross mit Gap 0, unabhaengig vom Outline-Modus
  for (const mode of [0, 1, 2]) {
    const dyn = buildShapes({ ...BASE, cl_crosshairstyle: 0, cl_crosshair_drawoutline: mode }, H, W, { spreadPx: 0 });
    const stat = buildShapes({ ...BASE, cl_crosshairstyle: 4, cl_crosshair_gap: 0, cl_crosshair_drawoutline: mode }, H, W);
    assert.deepEqual(geo(dyn), geo(stat));
  }
});

test('rescale keeps the sign of the gap and never rounds a non-zero value to 0', async () => {
  const { scaleGap, scalePx } = await load();
  assert.equal(scaleGap(-10, 1080, 960), -9);
  assert.equal(scaleGap(-1, 1080, 240), -1);
  assert.equal(scaleGap(0, 1080, 960), 0);
  assert.equal(scaleGap(10, 1080, 960), scalePx(10, 1080, 960));
  assert.equal(scaleGap(-7, 1080, 1080), -7);
  assert.equal(scaleGap(-3840, 1080, 2160), -7680); // reine Umrechnung; der Cvar-Clamp folgt in buildShapes
});

test('rescaled values are clamped back into the cvar range (the game writes them to the cvars)', async () => {
  const { buildShapes } = await load();
  // 960 -> 1080 (Faktor 1.125): 255 * 1.125 = 287 und 32 * 1.125 = 36 waeren ausserhalb der Cvar-Range.
  const s = buildShapes({ ...BASE, cl_crosshair_length: 255, cl_crosshair_thickness: 32, cl_crosshair_gap: 0,
    cl_crosshair_screen_height: 960 }, H, W);
  assert.deepEqual(s[0].a, [CX - 255, CY - 16, CX - 1, CY + 15]);
  const far = buildShapes({ ...BASE, cl_crosshair_gap: 3840, cl_crosshair_screen_height: 540 }, H, W);
  assert.equal(far[0].a[2], CX - 3840 - 1); // Gap bleibt bei 3840 statt 7680
});

test('Classic split lengths and alphas follow the float32 arithmetic of the game', async () => {
  const { buildShapes } = await load();
  const split = (ratio, over = {}) => buildShapes({ ...BASE, cl_crosshairstyle: 2, cl_crosshair_length: 10, cl_crosshair_gap: 0,
    cl_crosshair_dynamic_splitdist: 3, cl_crosshair_dynamic_maxdist_splitratio: ratio, ...over }, H, W, { spreadPx: 45 });
  const len = (sh) => sh.a[2] - sh.a[0] + 1;
  // ratio 0.7: float32 (1 - 0.7f) * 10 = 3.0 exakt -> innen 3 (double: 3.0000000000000004 -> 4)
  let s = split(0.7);
  assert.equal(len(s[0]), 7); assert.equal(len(s[4]), 3);
  // ratio 0.9: float32 (1 - 0.9f) * 10 = 1.0000002 -> innen 2 (double: 0.9999999999999998 -> 1)
  s = split(0.9);
  assert.equal(len(s[0]), 9); assert.equal(len(s[4]), 2);
  // alpha 100 * 0.29f = 29.000002 -> 29 (double: 28.999999999999996 -> 28)
  s = split(0.5, { cl_crosshaircolor_a: 100, cl_crosshair_dynamic_splitalpha_innermod: 0.29 });
  close(s[4].fill[3], 29 / 255);
});

test('thickness 32 is accepted, style values above 9 clamp to 9', async () => {
  const { buildShapes } = await load();
  const s = buildShapes({ ...BASE, cl_crosshair_thickness: 32 }, H, W);
  assert.deepEqual(s[0].a, [CX - 4 - 8, CY - 16, CX - 4 - 1, CY + 15]);
  assert.equal(buildShapes({ ...BASE, cl_crosshairstyle: 12 }, H, W)[0].type, 2);
});

test('Dynamic Quadrant: the spread ring is drawn even with thickness 0 (the cross is not)', async () => {
  const { buildShapes } = await load();
  const s = buildShapes({ ...BASE, cl_crosshairstyle: 7, cl_crosshair_thickness: 0 }, H, W, { spreadPx: 7 });
  assert.equal(s.length, 1);
  assert.equal(s[0].type, 1);
  assert.deepEqual(s[0].a, [CX - 0.5, CY - 0.5, 8, 1]); // e0 7 + max(1, t - 1), Breite max(1, t - 1)
  assert.equal(buildShapes({ ...BASE, cl_crosshairstyle: 7, cl_crosshair_thickness: 0 }, H, W, { spreadPx: 0 }).length, 0);
});
