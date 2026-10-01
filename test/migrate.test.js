'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { migrateLegacyParams } = require('../lib/migrate');
const { isLegacyParams, CVAR_KEYS } = require('../lib/cvars');
const { GREEN_RESTORE_PARAMS } = require('../lib/defaults');

// Altes gruenes Restore (Cvar-Satz vor 2026-09-22), wie es in presets.json lag.
const LEGACY_GREEN = Object.freeze({
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

test('green restore migrates at 960px to the literal in lib/defaults.js', () => {
  const r = migrateLegacyParams(LEGACY_GREEN, { screenHeight: 960 });
  assert.deepEqual(r, GREEN_RESTORE_PARAMS);
  assert.equal(r.cl_crosshairstyle, 4);
  assert.equal(r.cl_crosshair_length, 2);
  assert.equal(r.cl_crosshair_thickness, 2);
  assert.equal(r.cl_crosshair_gap, 1);
  assert.equal(r.cl_crosshair_drawoutline, 0); // outlinethickness 0 -> keine Outline
  assert.equal(r.cl_crosshaircolor_r, 0);
  assert.equal(r.cl_crosshaircolor_g, 255);
  assert.equal(r.cl_crosshaircolor_b, 91);
  assert.equal(r.cl_crosshaircolor_a, 255);
  assert.equal(r.cl_crosshair_screen_height, 960);
});

test('migration result is a complete, non-legacy param set', () => {
  const r = migrateLegacyParams(LEGACY_GREEN, { screenHeight: 960 });
  assert.deepEqual(Object.keys(r).sort(), [...CVAR_KEYS].sort());
  assert.equal(isLegacyParams(r), false);
  assert.equal(isLegacyParams(LEGACY_GREEN), true);
});

test('color preset cl_crosshaircolor 1 overrides RGB with 50/250/50', () => {
  const r = migrateLegacyParams({ ...LEGACY_GREEN, cl_crosshaircolor: 1 }, { screenHeight: 960 });
  assert.equal(r.cl_crosshaircolor_r, 50);
  assert.equal(r.cl_crosshaircolor_g, 250);
  assert.equal(r.cl_crosshaircolor_b, 50);
});

test('cl_crosshaircolor 5 (custom) keeps the RGB values', () => {
  const r = migrateLegacyParams({ ...LEGACY_GREEN, cl_crosshaircolor: 5 }, { screenHeight: 960 });
  assert.deepEqual(
    [r.cl_crosshaircolor_r, r.cl_crosshaircolor_g, r.cl_crosshaircolor_b],
    [0, 255, 91],
  );
});

test('usealpha 0 forces alpha 255, usealpha 1 keeps cl_crosshairalpha', () => {
  const off = migrateLegacyParams({ ...LEGACY_GREEN, cl_crosshairusealpha: 0, cl_crosshairalpha: 120 }, { screenHeight: 960 });
  assert.equal(off.cl_crosshaircolor_a, 255);
  const on = migrateLegacyParams({ ...LEGACY_GREEN, cl_crosshairusealpha: 1, cl_crosshairalpha: 120 }, { screenHeight: 960 });
  assert.equal(on.cl_crosshaircolor_a, 120);
});

test('style mapping: 1 -> 4 (static), 3 -> 0 (dynamic), others keep their number', () => {
  const at = (style) => migrateLegacyParams({ ...LEGACY_GREEN, cl_crosshairstyle: style }, { screenHeight: 960 }).cl_crosshairstyle;
  assert.equal(at(1), 4);
  assert.equal(at(3), 0);
  assert.equal(at(0), 0);
  assert.equal(at(2), 2);
  assert.equal(at(4), 4);
  assert.equal(at(5), 5);
});

test('splitdist null -> default 3, explicit value is kept', () => {
  const nul = migrateLegacyParams({ ...LEGACY_GREEN, cl_crosshair_dynamic_splitdist: null }, { screenHeight: 960 });
  assert.equal(nul.cl_crosshair_dynamic_splitdist, 3);
  const { cl_crosshair_dynamic_splitdist: _omit, ...without } = LEGACY_GREEN;
  assert.equal(migrateLegacyParams(without, { screenHeight: 960 }).cl_crosshair_dynamic_splitdist, 3);
  const set = migrateLegacyParams({ ...LEGACY_GREEN, cl_crosshair_dynamic_splitdist: 7 }, { screenHeight: 960 });
  assert.equal(set.cl_crosshair_dynamic_splitdist, 7);
});

test('negative gaps clamp to 0 (no negative distances in the new system)', () => {
  const r = migrateLegacyParams({ ...LEGACY_GREEN, cl_crosshairgap: -500 }, { screenHeight: 960 });
  assert.equal(r.cl_crosshair_gap, 0);
  const r2 = migrateLegacyParams({ ...LEGACY_GREEN, cl_crosshairgap: -30, cl_crosshairthickness: 30 }, { screenHeight: 960 });
  assert.equal(r2.cl_crosshair_gap, 4); // floor(60/2) - 26
});

test('oversized legacy values are clamped into the new cvar ranges', () => {
  const r = migrateLegacyParams({ ...LEGACY_GREEN, cl_crosshairsize: 500, cl_crosshairthickness: 30 }, { screenHeight: 960 });
  assert.equal(r.cl_crosshair_length, 255);
  assert.equal(r.cl_crosshair_thickness, 32);
});

test('outline color: black with the crosshair alpha (how the old outline was drawn)', () => {
  const opaque = migrateLegacyParams({ ...LEGACY_GREEN }, { screenHeight: 960 });
  assert.deepEqual(
    [opaque.cl_crosshairoutline_r, opaque.cl_crosshairoutline_g, opaque.cl_crosshairoutline_b, opaque.cl_crosshairoutline_a],
    [0, 0, 0, 255],
  );
  const translucent = migrateLegacyParams({ ...LEGACY_GREEN, cl_crosshairusealpha: 1, cl_crosshairalpha: 120 }, { screenHeight: 960 });
  assert.equal(translucent.cl_crosshaircolor_a, 120);
  assert.equal(translucent.cl_crosshairoutline_a, 120);
});

test('outline: drawoutline 1 with outlinethickness > 0 -> full outline (1)', () => {
  const r = migrateLegacyParams({ ...LEGACY_GREEN, cl_crosshair_drawoutline: 1, cl_crosshair_outlinethickness: 1 }, { screenHeight: 960 });
  assert.equal(r.cl_crosshair_drawoutline, 1);
});
