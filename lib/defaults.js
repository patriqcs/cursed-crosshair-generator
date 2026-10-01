'use strict';

// Cvar-Satz seit dem CS2-Crosshair-Update vom 2026-09-22 (Pixel-Einheiten,
// Bezugshoehe cl_crosshair_screen_height). Modell/Ranges: public/js/cvars.js.

// Gruenes Standard-Crosshair (Spec Abschnitt 8). Herkunft: einmalig berechnet mit
// migrateLegacyParams(alteWerte, { screenHeight: 960 }) aus den alten Werten
// style 4, size 0.8, thickness 0.9, gap -4, drawoutline 1 / outlinethickness 0,
// usealpha 0, RGB 0/255/91 — 960 = Spielaufloesung des Streamers, auf die das
// Crosshair entworfen wurde. Als Literal hinterlegt, damit der Seed nicht von der
// Migrationsformel abhaengt.
const GREEN_RESTORE_PARAMS = Object.freeze({
  cl_crosshairstyle: 4,
  cl_crosshair_length: 2,
  cl_crosshair_thickness: 2,
  cl_crosshair_gap: 1,
  cl_crosshairdot: 0,
  cl_crosshair_t: 0,
  cl_crosshair_recoil: 0,
  cl_crosshair_drawoutline: 0,
  cl_crosshaircolor_r: 0,
  cl_crosshaircolor_g: 255,
  cl_crosshaircolor_b: 91,
  cl_crosshaircolor_a: 255,
  cl_crosshairoutline_r: 0,
  cl_crosshairoutline_g: 0,
  cl_crosshairoutline_b: 0,
  cl_crosshairoutline_a: 255,
  cl_crosshair_dynamic_spread_limit: 255,
  cl_crosshair_dynamic_splitdist: 3,
  cl_crosshair_dynamic_splitalpha_innermod: 0,
  cl_crosshair_dynamic_splitalpha_outermod: 1,
  cl_crosshair_dynamic_maxdist_splitratio: 1,
  cl_ironsight_usecrosshaircolor: 0,
  cl_ironsight_dot_scale: 1,
  cl_crosshair_screen_height: 960,
});

// Starter-Preset fuer den ersten Start: "cursed", aber innerhalb der neuen
// Ranges (length 0-255, thickness 0-32), die das Spiel hart clampt. Outline-Alpha =
// Crosshair-Alpha, so sah das Preset vor der Outline-Farbe (2026-09-30) aus.
const STARTER_PRESET_PARAMS = Object.freeze({
  cl_crosshairstyle: 7,
  cl_crosshair_length: 40,
  cl_crosshair_thickness: 6,
  cl_crosshair_gap: 2,
  cl_crosshairdot: 1,
  cl_crosshair_t: 0,
  cl_crosshair_recoil: 1,
  cl_crosshair_drawoutline: 1,
  cl_crosshaircolor_r: 255,
  cl_crosshaircolor_g: 0,
  cl_crosshaircolor_b: 200,
  cl_crosshaircolor_a: 220,
  cl_crosshairoutline_r: 0,
  cl_crosshairoutline_g: 0,
  cl_crosshairoutline_b: 0,
  cl_crosshairoutline_a: 220,
  cl_crosshair_dynamic_spread_limit: 255,
  cl_crosshair_dynamic_splitdist: 3,
  cl_crosshair_dynamic_splitalpha_innermod: 0,
  cl_crosshair_dynamic_splitalpha_outermod: 1,
  cl_crosshair_dynamic_maxdist_splitratio: 1,
  cl_ironsight_usecrosshaircolor: 0,
  cl_ironsight_dot_scale: 1,
  cl_crosshair_screen_height: 1080,
});

const DEFAULT_KEYS = Object.freeze({ next: 'f7', restore: 'f8' });

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

module.exports = {
  GREEN_RESTORE_PARAMS,
  STARTER_PRESET_PARAMS,
  DEFAULT_KEYS,
  clone,
};
