// Rendert die erwarteten Crosshair-Pixel (premultiplied -> straight RGBA) fuer jeden
// Kalibrierfall in einem Ausschnitt um die Bildmitte und schreibt sie als Raw-RGBA.
//   node tools/calib-expected.mjs data/calibration-v2 [W H]
import { buildShapes, shadePixel } from '../public/js/preview.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const dir = process.argv[2] || 'data/calibration-v2';
const W = Number(process.argv[3] || 1920), H = Number(process.argv[4] || 1080);
const cases = JSON.parse(readFileSync(`${dir}/codes.json`, 'utf8'));
mkdirSync(`${dir}/expected`, { recursive: true });
const meta = [];
for (const c of cases) {
  if (c.res !== '1080') continue;
  const R = c.n === '14' ? 150 : 64;
  const cx = Math.trunc(W / 2), cy = Math.trunc(H / 2);
  // Shader-Eingang wie im Spiel: Cvar-Farbe sRGB -> linear, dann Shader (premultiplied).
  const s2l = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const shapes = buildShapes(c.params, H, W, { spreadPx: 0 }).map((sh) => ({
    ...sh, fill: [s2l(sh.fill[0]), s2l(sh.fill[1]), s2l(sh.fill[2]), sh.fill[3]],
  }));
  const w = 2 * R, h = 2 * R;
  // Float32 [r_pm_lin, g_pm_lin, b_pm_lin, a] pro Pixel
  const arr = new Float32Array(w * h * 4);
  const px = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    shadePixel(shapes, cx - R + x, cy - R + y, px);
    const i = (y * w + x) * 4;
    arr[i] = px[0]; arr[i + 1] = px[1]; arr[i + 2] = px[2]; arr[i + 3] = px[3];
  }
  const buf = Buffer.from(arr.buffer);
  writeFileSync(`${dir}/expected/${c.n}.f32`, buf);
  meta.push({ n: c.n, x0: cx - R, y0: cy - R, w, h, shapes });
}
writeFileSync(`${dir}/expected/meta.json`, JSON.stringify(meta, null, 1));
console.log('expected written:', meta.length);
