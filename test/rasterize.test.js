'use strict';

// Der schnelle Rasterizer (nur belegte Pixel, nur betroffene Shapes) muss exakt dieselben
// Pixel liefern wie die einfache Referenz: Shader fuer JEDES Pixel der Bounding-Box mit ALLEN Shapes.

const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../public/js/preview.js');
const W = 1920, H = 1080;

// Referenz = das Verhalten vor der Optimierung, ohne Hintergrund (straight alpha).
function reference(shapes, shadePixel, r) {
  const d = new Uint8ClampedArray(r.w * r.h * 4);
  const px = [0, 0, 0, 0];
  const c = (v) => Math.min(Math.max(v, 0), 1);
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    shadePixel(shapes, r.x + x, r.y + y, px);
    if (px[3] <= 0) continue;
    const i = (y * r.w + x) * 4;
    d[i] = Math.round(c(px[0]) * 255); d[i + 1] = Math.round(c(px[1]) * 255);
    d[i + 2] = Math.round(c(px[2]) * 255); d[i + 3] = Math.round(px[3] * 255);
  }
  return d;
}

// Kleiner deterministischer Zufallsgenerator (mulberry32), damit der Test reproduzierbar ist.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

test('fast rasterizer is pixel-identical to the brute-force reference (random presets, all styles)', async () => {
  const { buildShapes, rasterizePixels, shadePixel } = await load();
  const rnd = rng(20261001);
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  let compared = 0;
  for (let n = 0; n < 160; n++) {
    const style = n % 10;
    const params = {
      cl_crosshairstyle: style,
      cl_crosshair_length: int(0, 60), cl_crosshair_thickness: int(0, 32), cl_crosshair_gap: int(-12, 60),
      cl_crosshairdot: int(0, 1), cl_crosshair_t: int(0, 1), cl_crosshair_drawoutline: int(0, 2),
      cl_crosshaircolor_r: int(0, 255), cl_crosshaircolor_g: int(0, 255), cl_crosshaircolor_b: int(0, 255), cl_crosshaircolor_a: int(1, 255),
      cl_crosshairoutline_r: int(0, 255), cl_crosshairoutline_g: int(0, 255), cl_crosshairoutline_b: int(0, 255), cl_crosshairoutline_a: int(0, 255),
      cl_crosshair_dynamic_spread_limit: int(0, 255), cl_crosshair_dynamic_splitdist: int(0, 20),
      cl_crosshair_dynamic_splitalpha_innermod: int(0, 100) / 100, cl_crosshair_dynamic_splitalpha_outermod: int(30, 100) / 100,
      cl_crosshair_dynamic_maxdist_splitratio: int(0, 100) / 100, cl_crosshair_screen_height: 1080,
    };
    const shapes = buildShapes(params, H, W, { spreadPx: int(0, 140), kick: int(0, 25) });
    const r = rasterizePixels(shapes, W, H, null);
    if (!r) { assert.equal(shapes.length, 0); continue; }
    const ref = reference(shapes, shadePixel, r);
    assert.equal(Buffer.compare(Buffer.from(r.data.buffer), Buffer.from(ref.buffer)), 0, `mismatch for ${JSON.stringify(params)}`);
    compared++;
  }
  assert.ok(compared > 120, `only ${compared} cases rendered`);
});

test('extreme presets stay on screen and render non-empty in every phase of the dynamic preview', async () => {
  const { buildShapes, rasterizePixels } = await load();
  const base = { cl_crosshairdot: 0, cl_crosshair_t: 0, cl_crosshair_drawoutline: 1,
    cl_crosshaircolor_r: 255, cl_crosshaircolor_g: 0, cl_crosshaircolor_b: 255, cl_crosshaircolor_a: 255,
    cl_crosshairoutline_a: 255, cl_crosshair_dynamic_spread_limit: 255, cl_crosshair_screen_height: 1080,
    cl_crosshair_length: 255, cl_crosshair_thickness: 32, cl_crosshair_gap: 128,
    cl_crosshair_dynamic_splitdist: 3, cl_crosshair_dynamic_splitalpha_innermod: 1, cl_crosshair_dynamic_splitalpha_outermod: 1,
    cl_crosshair_dynamic_maxdist_splitratio: 0.5 };
  for (const [w, h] of [[1920, 1080], [1280, 960], [1280, 720], [2560, 1440]]) {
    for (let style = 0; style <= 9; style++) {
      for (const spreadPx of [0, 7, 60, 112, 150, 320]) {
        for (const kick of [0, 25]) {
          const shapes = buildShapes({ ...base, cl_crosshairstyle: style }, h, w, { spreadPx, kick });
          const r = rasterizePixels(shapes, w, h, null);
          // Style 1 und der Quadrant-Ring existieren ohne Spread nicht; alles andere muss sichtbar sein.
          if (style === 1 && spreadPx === 0) { assert.ok(r, 'dynamic circle at spread 0 draws a ring of radius 0'); }
          assert.ok(r, `nothing rendered: style ${style} spread ${spreadPx} ${w}x${h}`);
          let visible = 0;
          for (let i = 3; i < r.data.length; i += 4) if (r.data[i] > 0) visible++;
          assert.ok(visible > 0, `empty image: style ${style} spread ${spreadPx} ${w}x${h}`);
        }
      }
    }
  }
});

test('shapes entirely off screen yield no image (gap far beyond the screen edge)', async () => {
  const { buildShapes, rasterizePixels } = await load();
  const shapes = buildShapes({ cl_crosshairstyle: 2, cl_crosshair_length: 8, cl_crosshair_thickness: 2, cl_crosshair_gap: 3840,
    cl_crosshair_dynamic_splitdist: 127, cl_crosshair_screen_height: 1080 }, H, W, { spreadPx: 0 });
  assert.equal(shapes.length, 4);
  // Bewusst kein assert.equal(ergebnis, null): schlaegt das fehl, baut Node einen Diff ueber das
  // Pixel-Array (Millionen Elemente) und belegt dabei zig GB RAM, bis der OOM-Killer zuschlaegt.
  assert.ok(rasterizePixels(shapes, W, H, null) === null, 'off-screen shapes must not produce an image');
});
