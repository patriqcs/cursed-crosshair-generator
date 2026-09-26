// Erzeugt die Kalibrier-Share-Codes fuer den Screenshot-Abgleich mit CS2 und
// schreibt die erwartete Geometrie (Shapes bei gegebener Aufloesung) als JSON.
//   node tools/calib-codes.mjs [outDir]
import { encode } from '../public/js/sharecode.js';
import { defaultParams } from '../public/js/cvars.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const base = {
  ...defaultParams(),
  cl_crosshaircolor_r: 255, cl_crosshaircolor_g: 0, cl_crosshaircolor_b: 255, cl_crosshaircolor_a: 255,
  cl_crosshair_drawoutline: 1, cl_crosshair_recoil: 0, cl_crosshair_screen_height: 1080,
};
const C = (desc, res, over) => ({ desc, res, params: { ...base, ...over } });

export const CASES = [
  C('Static Cross, Spiel-Default: t=2 (gerade), gap=4, len=8, Full Outline', '1080', { cl_crosshairstyle: 4 }),
  C('Static Cross, ungerade Dicke: t=3, gap=4, len=8', '1080', { cl_crosshairstyle: 4, cl_crosshair_thickness: 3 }),
  C('Static Cross, t=1, gap=0, len=10 (Balken beruehren sich?)', '1080', { cl_crosshairstyle: 4, cl_crosshair_thickness: 1, cl_crosshair_gap: 0, cl_crosshair_length: 10 }),
  C('Static Cross, Half Outline: t=4, gap=6, len=12', '1080', { cl_crosshairstyle: 4, cl_crosshair_thickness: 4, cl_crosshair_gap: 6, cl_crosshair_length: 12, cl_crosshair_drawoutline: 2 }),
  C('Static Cross, keine Outline, Alpha 128, gruen: t=6, gap=5, len=14', '1080', { cl_crosshairstyle: 4, cl_crosshair_thickness: 6, cl_crosshair_gap: 5, cl_crosshair_length: 14, cl_crosshair_drawoutline: 0, cl_crosshaircolor_r: 0, cl_crosshaircolor_g: 255, cl_crosshaircolor_b: 0, cl_crosshaircolor_a: 128 }),
  C('Dot Only, t=5 (ungerade)', '1080', { cl_crosshairstyle: 6, cl_crosshair_thickness: 5 }),
  C('Static Cross + Dot, T-Style: t=2, gap=4, len=8', '1080', { cl_crosshairstyle: 4, cl_crosshairdot: 1, cl_crosshair_t: 1 }),
  C('Static Circle: t=2, gap=10', '1080', { cl_crosshairstyle: 3, cl_crosshair_gap: 10 }),
  C('Static Circle + Dot, ungerade: t=3, gap=5', '1080', { cl_crosshairstyle: 3, cl_crosshair_thickness: 3, cl_crosshair_gap: 5, cl_crosshairdot: 1 }),
  C('Static Square: t=2, gap=8', '1080', { cl_crosshairstyle: 8, cl_crosshair_gap: 8 }),
  C('Static Square + Dot, ungerade: t=3, gap=6', '1080', { cl_crosshairstyle: 8, cl_crosshair_thickness: 3, cl_crosshair_gap: 6, cl_crosshairdot: 1 }),
  C('Dynamic Quad: t=2, gap=4, len=8 (Messer UND einmal mit Gewehr stillstehend)', '1080', { cl_crosshairstyle: 7 }),
  C('Dynamic Circle: t=2, Spread-Limit 255 (Messer UND Gewehr)', '1080', { cl_crosshairstyle: 1 }),
  C('Gross: t=10, gap=30, len=100, Full Outline', '1080', { cl_crosshairstyle: 4, cl_crosshair_thickness: 10, cl_crosshair_gap: 30, cl_crosshair_length: 100 }),
  C('Skalierung: wie Nr. 1, aber bei 1280x960 importieren; danach Share-Code kopieren + Konsole "screenshot"', '960', { cl_crosshairstyle: 4 }),
  C('Skalierung: t=3, gap=5, len=9 bei 1280x960 importieren; danach Share-Code kopieren + "screenshot"', '960', { cl_crosshairstyle: 4, cl_crosshair_thickness: 3, cl_crosshair_gap: 5, cl_crosshair_length: 9 }),
];

const outDir = process.argv[2] || 'data/calibration-v2';
mkdirSync(outDir, { recursive: true });
const rows = [];
const json = [];
CASES.forEach((c, i) => {
  const n = String(i + 1).padStart(2, '0');
  const { code, clamped } = encode(c.params);
  if (clamped.length) throw new Error(`clamped in case ${n}`);
  rows.push(`| ${n} | ${c.res === '960' ? '1280x960' : '1920x1080'} | \`${code}\` | ${c.desc} |`);
  json.push({ n, code, res: c.res, desc: c.desc, params: c.params });
});
const md = ['| Nr | Aufloesung | Code | Was wird geprueft |', '|---|---|---|---|', ...rows].join('\n');
writeFileSync(`${outDir}/codes.md`, md + '\n');
writeFileSync(`${outDir}/codes.json`, JSON.stringify(json, null, 2));
console.log(md);
