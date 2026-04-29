'use strict';

// Green default crosshair as specified in Section 8 of the spec.
const GREEN_RESTORE_PARAMS = Object.freeze({
  cl_crosshairstyle: 4,
  cl_crosshairsize: 0.8,
  cl_crosshairthickness: 0.9,
  cl_crosshairgap: -4,
  cl_crosshairdot: 0,
  cl_crosshair_t: 0,
  cl_crosshair_recoil: 0,
  cl_crosshairgap_useweaponvalue: 0,
  cl_fixedcrosshairgap: 3,
  cl_crosshair_drawoutline: 1,
  cl_crosshair_outlinethickness: 0,
  cl_crosshairusealpha: 0,
  cl_crosshairalpha: 255,
  cl_crosshaircolor_r: 0,
  cl_crosshaircolor_g: 255,
  cl_crosshaircolor_b: 91,
  cl_crosshair_dynamic_maxdist_splitratio: 1,
  cl_crosshair_dynamic_splitalpha_innermod: 0,
  cl_crosshair_dynamic_splitalpha_outermod: 1,
  cl_crosshair_dynamic_splitdist: 3,
});

// A starter cursed preset to give first-run users something to look at.
// All numeric values stay within CS2 cvar limits (size 0-20, thickness 0-2,
// gap -5..5, outlinethickness 0-3).
const STARTER_PRESET_PARAMS = Object.freeze({
  cl_crosshairstyle: 4,
  cl_crosshairsize: 8,
  cl_crosshairthickness: 2,
  cl_crosshairgap: -2,
  cl_crosshairdot: 1,
  cl_crosshair_t: 0,
  cl_crosshair_recoil: 1,
  cl_crosshair_drawoutline: 1,
  cl_crosshair_outlinethickness: 1,
  cl_crosshairusealpha: 1,
  cl_crosshairalpha: 220,
  cl_crosshaircolor_r: 255,
  cl_crosshaircolor_g: 0,
  cl_crosshaircolor_b: 200,
  cl_crosshair_dynamic_splitdist: null,
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
