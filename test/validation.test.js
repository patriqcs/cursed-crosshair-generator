'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sanitizePresetName,
  sanitizeSubmitterName,
  validateParams,
} = require('../lib/validation');
const { CVAR_KEYS, CVARS } = require('../lib/cvars');

test('sanitizePresetName rejects names containing double-quote', () => {
  assert.equal(sanitizePresetName('evil"name'), null);
});

test('sanitizePresetName rejects names containing semicolon', () => {
  assert.equal(sanitizePresetName('evil;name'), null);
});

test('sanitizePresetName accepts a benign name', () => {
  assert.equal(sanitizePresetName('Inferno'), 'Inferno');
});

test('sanitizeSubmitterName rejects names with double-quote (cfg injection)', () => {
  assert.equal(sanitizeSubmitterName('evil"name'), null);
});

test('sanitizeSubmitterName rejects names with semicolon (cfg injection)', () => {
  assert.equal(sanitizeSubmitterName('evil;name'), null);
});

test('sanitizeSubmitterName accepts benign 2-40 char input', () => {
  assert.equal(sanitizeSubmitterName('patrick'), 'patrick');
});

test('sanitizeSubmitterName strips control characters', () => {
  assert.equal(sanitizeSubmitterName('pat\x01rick'), 'patrick');
});

test('sanitizeSubmitterName rejects too short', () => {
  assert.equal(sanitizeSubmitterName('p'), null);
});

test('sanitizePresetName rejects angle brackets (XSS defense-in-depth)', () => {
  assert.equal(sanitizePresetName('<img src=x>'), null);
  assert.equal(sanitizePresetName('a<b'), null);
  assert.equal(sanitizePresetName('a>b'), null);
});

test('sanitizeSubmitterName rejects angle brackets', () => {
  assert.equal(sanitizeSubmitterName('<script>'), null);
});

// Vollstaendiger Param-Satz im neuen Schema (CS2 seit 2026-09-22, Stand 2026-09-30).
const FULL_PARAMS = Object.freeze({
  cl_crosshairstyle: 4,
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
  cl_crosshairoutline_r: 10,
  cl_crosshairoutline_g: 20,
  cl_crosshairoutline_b: 30,
  cl_crosshairoutline_a: 128,
  cl_crosshair_dynamic_spread_limit: 255,
  cl_crosshair_dynamic_splitdist: 3,
  cl_crosshair_dynamic_splitalpha_innermod: 0,
  cl_crosshair_dynamic_splitalpha_outermod: 1,
  cl_crosshair_dynamic_maxdist_splitratio: 1,
  cl_ironsight_usecrosshaircolor: 1,
  cl_ironsight_dot_scale: 1.25,
  cl_crosshair_screen_height: 1080,
});

test('validateParams returns exactly the CVAR_KEYS set for a full input', () => {
  const r = validateParams(FULL_PARAMS);
  assert.deepEqual(Object.keys(r).sort(), [...CVAR_KEYS].sort());
  assert.deepEqual(r, FULL_PARAMS);
});

test('validateParams clamps out-of-range ints to the cvar range instead of rejecting', () => {
  const r = validateParams({
    ...FULL_PARAMS,
    cl_crosshair_length: 99999,
    cl_crosshair_thickness: -5,
    cl_crosshair_gap: 5000,
    cl_crosshaircolor_r: 300,
    cl_crosshairoutline_a: -1,
    cl_ironsight_dot_scale: 9,
  });
  assert.equal(r.cl_crosshair_length, CVARS.cl_crosshair_length.max);
  assert.equal(r.cl_crosshair_thickness, 0);
  assert.equal(r.cl_crosshair_gap, 3840);
  assert.equal(r.cl_crosshaircolor_r, 255);
  assert.equal(r.cl_crosshairoutline_a, 0);
  assert.equal(r.cl_ironsight_dot_scale, 2);
});

test('validateParams keeps negative gaps (cvar range -3840..3840 since 2026-09-30)', () => {
  assert.equal(validateParams({ ...FULL_PARAMS, cl_crosshair_gap: -10 }).cl_crosshair_gap, -10);
  assert.equal(validateParams({ ...FULL_PARAMS, cl_crosshair_gap: -99999 }).cl_crosshair_gap, -3840);
  assert.equal(validateParams({ ...FULL_PARAMS, cl_crosshair_thickness: 32 }).cl_crosshair_thickness, 32);
  assert.equal(validateParams({ ...FULL_PARAMS, cl_crosshair_thickness: 33 }).cl_crosshair_thickness, 32);
});

test('validateParams clamps out-of-range enums (style, outline) instead of rejecting', () => {
  const r = validateParams({ ...FULL_PARAMS, cl_crosshairstyle: 99, cl_crosshair_drawoutline: -3 });
  assert.equal(r.cl_crosshairstyle, 9);
  assert.equal(r.cl_crosshair_drawoutline, 0);
  assert.equal(validateParams({ ...FULL_PARAMS, cl_crosshairstyle: 9 }).cl_crosshairstyle, 9);
});

test('validateParams quantises floats to the cvar step and clamps to range', () => {
  const r = validateParams({
    ...FULL_PARAMS,
    cl_crosshair_dynamic_splitalpha_outermod: 0.123,
    cl_crosshair_dynamic_maxdist_splitratio: 0.456,
    cl_crosshair_dynamic_splitalpha_innermod: 0.374,
  });
  assert.equal(r.cl_crosshair_dynamic_splitalpha_outermod, 0.3); // min 0.3
  assert.equal(r.cl_crosshair_dynamic_maxdist_splitratio, 0.46); // step 0.01
  assert.equal(r.cl_crosshair_dynamic_splitalpha_innermod, 0.37); // step 0.01 seit 2026-09-30 (vorher 0.05)
  const fine = validateParams({ ...FULL_PARAMS, cl_crosshair_dynamic_splitalpha_outermod: 0.83 });
  assert.equal(fine.cl_crosshair_dynamic_splitalpha_outermod, 0.83);
});

test('validateParams fills missing keys with cvar defaults', () => {
  const r = validateParams({ cl_crosshair_length: 12 });
  assert.equal(r.cl_crosshair_length, 12);
  for (const k of CVAR_KEYS) {
    if (k === 'cl_crosshair_length') continue;
    assert.equal(r[k], CVARS[k].default, `default for ${k}`);
  }
});

test('validateParams drops unknown and legacy keys', () => {
  const r = validateParams({ ...FULL_PARAMS, bogus: 1, cl_crosshairsize: 5, __proto__x: 1 });
  assert.equal('bogus' in r, false);
  assert.equal('cl_crosshairsize' in r, false);
});

test('validateParams coerces numeric strings and booleans', () => {
  const r = validateParams({ ...FULL_PARAMS, cl_crosshair_length: '17', cl_crosshairdot: 'true', cl_crosshair_t: false });
  assert.equal(r.cl_crosshair_length, 17);
  assert.equal(r.cl_crosshairdot, 1);
  assert.equal(r.cl_crosshair_t, 0);
});

test('validateParams rejects non-numeric values', () => {
  assert.equal(validateParams({ ...FULL_PARAMS, cl_crosshair_length: 'abc' }), null);
  assert.equal(validateParams({ ...FULL_PARAMS, cl_crosshairstyle: 'x' }), null);
  assert.equal(validateParams({ ...FULL_PARAMS, cl_crosshair_gap: NaN }), null);
});

test('validateParams rejects when a param contains a double-quote (cfg injection)', () => {
  assert.equal(validateParams({ ...FULL_PARAMS, cl_crosshair_length: 'evil"' }), null);
  assert.equal(validateParams({ ...FULL_PARAMS, cl_crosshairstyle: '4"' }), null);
});

test('validateParams rejects when a param contains a semicolon (cfg injection)', () => {
  assert.equal(validateParams({ ...FULL_PARAMS, cl_crosshair_gap: '1; quit' }), null);
});

test('validateParams rejects non-object input', () => {
  assert.equal(validateParams(null), null);
  assert.equal(validateParams('x'), null);
  assert.equal(validateParams(42), null);
});

test('validateParams restore option makes no difference (same schema)', () => {
  assert.deepEqual(validateParams(FULL_PARAMS, { restore: true }), validateParams(FULL_PARAMS));
});
