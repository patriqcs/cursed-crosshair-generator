// Erzeugt die Kalibrier-Share-Codes fuer den Screenshot-Abgleich mit CS2 und
// schreibt die Faelle als Tabelle (codes.md) und JSON (codes.json).
//   node tools/calib-codes.mjs [outDir] [--set v3|v2]
// Set v3 (Default) = Neuerungen des Updates vom 2026-09-30, Set v2 = die 16 Faelle vom
// 2026-09-26 (deren Screenshots unter data/calibration-v2/shots liegen). Die Codes sind
// im neuen Format (CS + 44 Zeichen); das Spiel nimmt nur noch dieses und alte V3/V4-Codes.
import { encode } from '../public/js/sharecode.js';
import { defaultParams } from '../public/js/cvars.js';
import { writeFileSync, mkdirSync } from 'node:fs';

const base = {
  ...defaultParams(),
  cl_crosshaircolor_r: 255, cl_crosshaircolor_g: 0, cl_crosshaircolor_b: 255, cl_crosshaircolor_a: 255,
  cl_crosshair_drawoutline: 1, cl_crosshair_recoil: 0, cl_crosshair_screen_height: 1080,
};
// r = optionaler Ausschnitt-Radius fuer calib-expected (Default 64 px um die Mitte).
const C = (desc, res, over, r) => ({ desc, res, params: { ...base, ...over }, ...(r ? { r } : {}) });

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


// Neuerungen vom 2026-09-30 (Build 2000922). Alle bei 1920x1080, Messer, ruhiger Hintergrund.
const CYAN = { cl_crosshairoutline_r: 0, cl_crosshairoutline_g: 255, cl_crosshairoutline_b: 255, cl_crosshairoutline_a: 255 };
export const CASES_V3 = [
  C('Static Quadrant: t=2, gap=10, Quadrant Size 0.5, Full Outline', '1080', { cl_crosshairstyle: 9, cl_crosshair_gap: 10, cl_crosshair_dynamic_maxdist_splitratio: 0.5 }),
  C('Static Quadrant + Dot, ungerade: t=3, gap=6, Size 1.0 (geschlossener Ring)', '1080', { cl_crosshairstyle: 9, cl_crosshair_thickness: 3, cl_crosshair_gap: 6, cl_crosshairdot: 1, cl_crosshair_dynamic_maxdist_splitratio: 1 }),
  C('Static Quadrant, Half Outline: t=6, gap=20, Size 0.25', '1080', { cl_crosshairstyle: 9, cl_crosshair_thickness: 6, cl_crosshair_gap: 20, cl_crosshair_drawoutline: 2, cl_crosshair_dynamic_maxdist_splitratio: 0.25 }),
  C('Static Quadrant, gap=0 (Radius wird 1): t=4, Size 0.75', '1080', { cl_crosshairstyle: 9, cl_crosshair_thickness: 4, cl_crosshair_gap: 0, cl_crosshair_dynamic_maxdist_splitratio: 0.75 }),
  C('Outline-Farbe Cyan deckend: Static Cross t=4, gap=6, len=12', '1080', { cl_crosshairstyle: 4, cl_crosshair_thickness: 4, cl_crosshair_gap: 6, cl_crosshair_length: 12, ...CYAN }),
  C('Outline Weiss mit Alpha 128 (Blend): Static Cross t=4, gap=6, len=12', '1080', { cl_crosshairstyle: 4, cl_crosshair_thickness: 4, cl_crosshair_gap: 6, cl_crosshair_length: 12, cl_crosshairoutline_r: 255, cl_crosshairoutline_g: 255, cl_crosshairoutline_b: 255, cl_crosshairoutline_a: 128 }),
  C('Fuellung Alpha 128, Outline Rot deckend: Static Cross t=6, gap=5, len=14', '1080', { cl_crosshairstyle: 4, cl_crosshair_thickness: 6, cl_crosshair_gap: 5, cl_crosshair_length: 14, cl_crosshaircolor_a: 128, cl_crosshairoutline_r: 255, cl_crosshairoutline_g: 0, cl_crosshairoutline_b: 0, cl_crosshairoutline_a: 255 }),
  C('Thickness 32: Static Cross gap=10, len=40', '1080', { cl_crosshairstyle: 4, cl_crosshair_thickness: 32, cl_crosshair_gap: 10, cl_crosshair_length: 40 }, 96),
  C('Negatives Gap -10 beim Static Cross (muss wie gap 0 aussehen): t=2, len=8', '1080', { cl_crosshairstyle: 4, cl_crosshair_gap: -10 }),
  C('Static Circle mit gelber Outline, ungerade: t=3, gap=8', '1080', { cl_crosshairstyle: 3, cl_crosshair_thickness: 3, cl_crosshair_gap: 8, cl_crosshairoutline_r: 255, cl_crosshairoutline_g: 255, cl_crosshairoutline_b: 0 }),
  C('Dynamic Cross mit Messer (Spread 0): Balken beginnen in der Mitte, t=2, len=8', '1080', { cl_crosshairstyle: 0 }),
  C('Classic mit gap=-10, Messer im Stand (muss wie gap 0 aussehen)', '1080', { cl_crosshairstyle: 2, cl_crosshair_gap: -10 }),
  C('Static Square mit Outline-Farbe Cyan: t=2, gap=8', '1080', { cl_crosshairstyle: 8, cl_crosshair_gap: 8, ...CYAN }),
];

const args = process.argv.slice(2);
const setIdx = args.indexOf('--set');
const setName = setIdx >= 0 ? args[setIdx + 1] : 'v3';
if (setIdx >= 0) args.splice(setIdx, 2);
const SETS = { v2: CASES, v3: CASES_V3 };
if (!SETS[setName]) throw new Error(`unknown set ${setName} (v2|v3)`);
const outDir = args[0] || `data/calibration-${setName}`;
mkdirSync(outDir, { recursive: true });
const rows = [];
const json = [];
SETS[setName].forEach((c, i) => {
  const n = String(i + 1).padStart(2, '0');
  const { code, clamped } = encode(c.params);
  if (clamped.length) throw new Error(`clamped in case ${n}`);
  rows.push(`| ${n} | ${c.res === '960' ? '1280x960' : '1920x1080'} | \`${code}\` | ${c.desc} |`);
  json.push({ n, code, res: c.res, desc: c.desc, params: c.params, ...(c.r ? { r: c.r } : {}) });
});
const md = ['| Nr | Aufloesung | Code | Was wird geprueft |', '|---|---|---|---|', ...rows].join('\n');
writeFileSync(`${outDir}/codes.md`, md + '\n');
writeFileSync(`${outDir}/codes.json`, JSON.stringify(json, null, 2));
console.log(md);
