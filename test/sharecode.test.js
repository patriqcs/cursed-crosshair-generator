'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// public/js/sharecode.js ist ein Browser-ES-Modul; per dynamic import auch in Node testbar.
const load = () => import('../public/js/sharecode.js');

// Testvektoren aus akiver/csgo-sharecode v6.0.0 (src/index.test.ts).
const V4 = [
  {
    code: 'CSGO-G8oAC-RyvWc-Hi3CZ-voSwn-QJbfE',
    params: {
      cl_crosshairstyle: 8, cl_crosshair_recoil: 0, cl_crosshair_drawoutline: 1,
      cl_crosshairdot: 1, cl_crosshair_t: 0,
      cl_crosshaircolor_r: 124, cl_crosshaircolor_g: 57, cl_crosshaircolor_b: 57, cl_crosshaircolor_a: 255,
      cl_crosshair_gap: 25, cl_crosshair_length: 7, cl_crosshair_thickness: 20,
      cl_crosshair_dynamic_spread_limit: 181, cl_crosshair_dynamic_splitdist: 3,
      cl_crosshair_dynamic_splitalpha_innermod: 1, cl_crosshair_dynamic_splitalpha_outermod: 0.35,
      cl_crosshair_dynamic_maxdist_splitratio: 0, cl_crosshair_screen_height: 768,
    },
  },
  {
    code: 'CSGO-sP6xU-TSyN9-sZcO5-2D48M-UppkP',
    params: {
      cl_crosshairstyle: 2, cl_crosshair_recoil: 1, cl_crosshair_drawoutline: 0,
      cl_crosshairdot: 1, cl_crosshair_t: 0,
      cl_crosshaircolor_r: 255, cl_crosshaircolor_g: 0, cl_crosshaircolor_b: 0, cl_crosshaircolor_a: 255,
      cl_crosshair_gap: 0, cl_crosshair_length: 5, cl_crosshair_thickness: 1,
      cl_crosshair_dynamic_spread_limit: 255, cl_crosshair_dynamic_splitdist: 3,
      cl_crosshair_dynamic_splitalpha_innermod: 1, cl_crosshair_dynamic_splitalpha_outermod: 0.3,
      cl_crosshair_dynamic_maxdist_splitratio: 0, cl_crosshair_screen_height: 768,
    },
  },
];

const V3 = [
  {
    code: 'CSGO-MnUCC-89iG7-2cVar-wy7Yn-amCpF',
    params: {
      cl_crosshairstyle: 6, cl_crosshair_recoil: 0, cl_crosshair_drawoutline: 1,
      cl_crosshairdot: 1, cl_crosshair_t: 0,
      cl_crosshaircolor_r: 252, cl_crosshaircolor_g: 15, cl_crosshaircolor_b: 192, cl_crosshaircolor_a: 255,
      cl_crosshair_gap: 4, cl_crosshair_length: 8, cl_crosshair_thickness: 3,
      cl_crosshair_dynamic_spread_limit: 255, cl_crosshair_dynamic_splitdist: 7,
      cl_crosshair_dynamic_splitalpha_innermod: 1, cl_crosshair_dynamic_splitalpha_outermod: 0.45,
      cl_crosshair_dynamic_maxdist_splitratio: 0.3, cl_crosshair_screen_height: 1080,
    },
  },
  {
    code: 'CSGO-hLbCn-69VT6-Bok83-9MOqW-SWzwQ',
    params: {
      cl_crosshairstyle: 4, cl_crosshair_recoil: 0, cl_crosshair_drawoutline: 0,
      cl_crosshairdot: 0, cl_crosshair_t: 0,
      cl_crosshaircolor_r: 50, cl_crosshaircolor_g: 250, cl_crosshaircolor_b: 50, cl_crosshaircolor_a: 255,
      cl_crosshair_gap: 4, cl_crosshair_length: 8, cl_crosshair_thickness: 2,
      cl_crosshair_dynamic_spread_limit: 255, cl_crosshair_dynamic_splitdist: 7,
      cl_crosshair_dynamic_splitalpha_innermod: 1, cl_crosshair_dynamic_splitalpha_outermod: 0.4,
      cl_crosshair_dynamic_maxdist_splitratio: 0.3, cl_crosshair_screen_height: 1080,
    },
  },
];

test('decodes V4 share codes (akiver test vectors)', async () => {
  const { decode } = await load();
  for (const { code, params } of V4) {
    const res = decode(code);
    assert.ok(res, `decode failed for ${code}`);
    assert.equal(res.version, 4);
    assert.deepEqual(res.params, params);
  }
});

test('encodes V4 share codes bit-exact (akiver test vectors)', async () => {
  const { encode } = await load();
  for (const { code, params } of V4) {
    const { code: out, clamped } = encode(params);
    assert.equal(out, code);
    assert.deepEqual(clamped, []);
  }
});

test('decodes V3 share codes (outline as bool)', async () => {
  const { decode } = await load();
  for (const { code, params } of V3) {
    const res = decode(code);
    assert.ok(res, `decode failed for ${code}`);
    assert.equal(res.version, 3);
    assert.deepEqual(res.params, params);
  }
});

test('V3 -> V4 re-encode roundtrips through decode', async () => {
  const { encode, decode } = await load();
  for (const { params } of V3) {
    const { code } = encode(params);
    const res = decode(code);
    assert.equal(res.version, 4);
    assert.deepEqual(res.params, params);
  }
});

test('decodes legacy V1 codes with old cvar names and legacy flag', async () => {
  const { decode } = await load();
  // akiver V1 crosshair sample
  const res = decode('CSGO-Cn37R-YE7vo-pLCAL-aURmZ-z6zkG');
  assert.ok(res);
  assert.equal(res.version, 1);
  assert.equal(res.legacy, true);
  assert.deepEqual(res.params, {
    cl_crosshairgap: -1.3,
    cl_crosshair_outlinethickness: 2,
    cl_crosshaircolor_r: 175,
    cl_crosshaircolor_g: 81,
    cl_crosshaircolor_b: 213,
    cl_crosshairalpha: 137,
    cl_crosshair_dynamic_splitdist: 6,
    cl_crosshair_recoil: 0,
    cl_fixedcrosshairgap: 3,
    cl_crosshaircolor: 5,
    cl_crosshair_drawoutline: 1,
    cl_crosshair_dynamic_splitalpha_innermod: 0.6,
    cl_crosshair_dynamic_splitalpha_outermod: 0.4,
    cl_crosshair_dynamic_maxdist_splitratio: 0.5,
    cl_crosshairthickness: 1.2,
    cl_crosshairstyle: 2,
    cl_crosshairdot: 1,
    cl_crosshairgap_useweaponvalue: 1,
    cl_crosshairusealpha: 1,
    cl_crosshair_t: 1,
    cl_crosshairsize: 4.6,
  });
});

test('rejects malformed or corrupted codes', async () => {
  const { decode } = await load();
  assert.equal(decode('CSGO-12345-12345-12345-12345-1234'), null);
  assert.equal(decode('whateverCSGO-12345-12345-12345-12345-12345'), null);
  assert.equal(decode('CSGO-G8oAC-RyvWc-Hi3CZ-voSwn-QJbfF'), null); // checksum mismatch
  assert.equal(decode(''), null);
  assert.equal(decode(null), null);
});

test('encode clamps out-of-range values and reports them', async () => {
  const { encode, decode } = await load();
  const { code, clamped } = encode({
    ...V4[0].params,
    cl_crosshair_length: 900, cl_crosshair_thickness: 40, cl_crosshair_gap: -3,
  });
  assert.deepEqual(clamped.map((c) => c.key).sort(), [
    'cl_crosshair_gap', 'cl_crosshair_length', 'cl_crosshair_thickness',
  ]);
  const res = decode(code);
  assert.equal(res.params.cl_crosshair_length, 255);
  assert.equal(res.params.cl_crosshair_thickness, 31);
  assert.equal(res.params.cl_crosshair_gap, 0);
});

test('encode handles split ratio float rounding (0.29 * 100)', async () => {
  const { encode, decode } = await load();
  const { code } = encode({ ...V4[0].params, cl_crosshair_dynamic_maxdist_splitratio: 0.29 });
  assert.equal(decode(code).params.cl_crosshair_dynamic_maxdist_splitratio, 0.29);
});
