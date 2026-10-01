'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// public/js/sharecode.js ist ein Browser-ES-Modul; per dynamic import auch in Node testbar.
const load = () => import('../public/js/sharecode.js');

// Neues Format (CS2 Build 2000922, 2026-09-30). Die Codes stammen NICHT aus dieser
// Implementierung, sondern aus der unabhaengigen Python-Referenz
// ~/projects/cs2-re/tools/sharecode_ref.py, die Encoder und Decoder des Spiels woertlich
// nach dem Decompilat von libclient.so nachbildet (Byte-Dump jeweils im Kommentar).
const P = (o) => ({
  cl_crosshairstyle: o.style, cl_crosshair_recoil: o.recoil, cl_crosshairdot: o.dot, cl_crosshair_t: o.t,
  cl_crosshaircolor_r: o.r, cl_crosshaircolor_g: o.g, cl_crosshaircolor_b: o.b, cl_crosshaircolor_a: o.a,
  cl_crosshairoutline_r: o.or, cl_crosshairoutline_g: o.og, cl_crosshairoutline_b: o.ob, cl_crosshairoutline_a: o.oa,
  cl_crosshair_thickness: o.thickness, cl_crosshair_drawoutline: o.outline,
  cl_crosshair_gap: o.gap, cl_crosshair_length: o.length, cl_crosshair_dynamic_spread_limit: o.spread,
  cl_crosshair_dynamic_splitdist: o.splitdist,
  cl_crosshair_dynamic_splitalpha_innermod: o.inner, cl_crosshair_dynamic_splitalpha_outermod: o.outer,
  cl_crosshair_dynamic_maxdist_splitratio: o.ratio,
  cl_ironsight_usecrosshaircolor: o.scopeColor, cl_ironsight_dot_scale: o.scopeScale,
  cl_crosshair_screen_height: o.h,
});
const CS = [
  { // 280138042700ff00ff000000ff42040008ff0380910c5a
    code: 'CSpb9t3x5NtrX5fWaENsr8vusEtwpiURjzqauLkOiYHMqF',
    params: P({ h: 1080, style: 7, recoil: 1, dot: 0, t: 0, r: 0, g: 255, b: 0, a: 255, or: 0, og: 0, ob: 0, oa: 255,
      outline: 1, thickness: 2, gap: 4, length: 8, spread: 255, splitdist: 3, inner: 0, outer: 1, ratio: 1,
      scopeColor: 0, scopeScale: 1 }),
  },
  { // Static Quadrant, Half Outline mit Farbe, Thickness 32: e901a00549ff00c8dc0a141e80a0110000000080b114a5
    code: 'CSB4NZmvtJKrSN5iFwA9vAeT9Yfsx7BGbERTKR837FDQHj',
    params: P({ h: 1440, style: 9, recoil: 0, dot: 1, t: 0, r: 255, g: 0, b: 200, a: 220, or: 10, og: 20, ob: 30, oa: 128,
      outline: 2, thickness: 32, gap: 17, length: 0, spread: 0, splitdist: 0, inner: 0, outer: 1, ratio: 0.37,
      scopeColor: 1, scopeScale: 1.75 }),
  },
  { // Classic mit negativem Gap und 0.01er-Alphas: bc01c003e2010203040506070801f6fffffeff5ca10300
    code: 'CSpK4EQ38zwLKy8vT68FzF5SaUnFbE57BdajVFATvusjsb',
    params: P({ h: 960, style: 2, recoil: 1, dot: 1, t: 1, r: 1, g: 2, b: 3, a: 4, or: 5, og: 6, ob: 7, oa: 8,
      outline: 0, thickness: 1, gap: -10, length: 255, spread: 254, splitdist: 127, inner: 0.57, outer: 0.35, ratio: 0.29,
      scopeColor: 0, scopeScale: 0.1 }),
  },
  { // Grenzwerte: bb01f00004ffffffffffffffff6000f1ffff7f320010be
    code: 'CSN8PAXvvdQ9jPKqPOQiypYMkVSXGS4QnAqsphPP6YJdjb',
    params: P({ h: 240, style: 4, recoil: 0, dot: 0, t: 0, r: 255, g: 255, b: 255, a: 255, or: 255, og: 255, ob: 255, oa: 255,
      outline: 1, thickness: 32, gap: -3840, length: 255, spread: 255, splitdist: 127, inner: 1, outer: 0.3, ratio: 0,
      scopeColor: 1, scopeScale: 2 }),
  },
];

test('encodes the new CS format bit-exact (reference vectors from the decompiled game encoder)', async () => {
  const { encode } = await load();
  for (const { code, params } of CS) {
    const { code: out, clamped } = encode(params);
    assert.equal(out, code);
    assert.equal(out.length, 46);
    assert.deepEqual(clamped, []);
  }
});

test('decodes the new CS format', async () => {
  const { decode } = await load();
  for (const { code, params } of CS) {
    const res = decode(code);
    assert.ok(res, `decode failed for ${code}`);
    assert.equal(res.format, 'CS');
    assert.equal(res.version, 1);
    assert.deepEqual(res.params, params);
  }
});

test('new format: decoder clamps like the game and rejects bad checksum / version / zero height', async () => {
  const { decode, encode } = await load();
  const ok = CS[0].code;
  // letztes Zeichen aendern -> Pruefsumme falsch
  const bad = ok.slice(0, -1) + (ok.endsWith('A') ? 'B' : 'A');
  assert.equal(decode(bad), null);
  assert.equal(decode(ok.slice(0, -1)), null);          // zu kurz
  assert.equal(decode(`XX${ok.slice(2)}`), null);       // falsches Praefix
  assert.equal(decode(`CS${'0'.repeat(44)}`), null);    // Zeichen ausserhalb des Alphabets
  assert.equal(decode(`CS${'9'.repeat(44)}`), null);    // Ueberlauf ueber 32 Bytes
  // screen_height < 240 wird beim Kodieren auf 240 gezogen (Decoder des Spiels clampt genauso)
  const low = encode({ ...CS[0].params, cl_crosshair_screen_height: 100 });
  assert.deepEqual(low.clamped.map((c) => c.key), ['cl_crosshair_screen_height']);
  assert.equal(decode(low.code).params.cl_crosshair_screen_height, 240);
});

test('encode clamps out-of-range values and reports them', async () => {
  const { encode, decode } = await load();
  const { code, clamped } = encode({
    ...CS[0].params,
    cl_crosshair_length: 900, cl_crosshair_thickness: 40, cl_crosshair_gap: -5000,
  });
  assert.deepEqual(clamped.map((c) => c.key).sort(), [
    'cl_crosshair_gap', 'cl_crosshair_length', 'cl_crosshair_thickness',
  ]);
  const res = decode(code);
  assert.equal(res.params.cl_crosshair_length, 255);
  assert.equal(res.params.cl_crosshair_thickness, 32);
  assert.equal(res.params.cl_crosshair_gap, -3840);
});

test('encode handles 0.01 float steps without rounding slips', async () => {
  const { encode, decode } = await load();
  for (let i = 0; i <= 100; i++) {
    const v = i / 100;
    const outer = Math.max(0.3, v);
    const scale = Number((0.1 + i * 0.019).toFixed(2));
    const { code } = encode({
      ...CS[0].params,
      cl_crosshair_dynamic_splitalpha_innermod: v,
      cl_crosshair_dynamic_splitalpha_outermod: outer,
      cl_crosshair_dynamic_maxdist_splitratio: v,
      cl_ironsight_dot_scale: scale,
    });
    const p = decode(code).params;
    assert.equal(p.cl_crosshair_dynamic_splitalpha_innermod, v);
    assert.equal(p.cl_crosshair_dynamic_splitalpha_outermod, outer);
    assert.equal(p.cl_crosshair_dynamic_maxdist_splitratio, v);
    assert.equal(p.cl_ironsight_dot_scale, scale);
  }
});

// ---------------------------------------------------------------------------
// Altes Format CSGO-XXXXX-... (weiterhin importierbar)
// ---------------------------------------------------------------------------

// Testvektoren aus akiver/csgo-sharecode v6.0.0 (src/index.test.ts). Die Outline-Felder
// ergaenzt der Decoder wie der CS2-Client beim Import: Schwarz, Alpha = Crosshair-Alpha.
const V4 = [
  {
    code: 'CSGO-G8oAC-RyvWc-Hi3CZ-voSwn-QJbfE',
    params: {
      cl_crosshairstyle: 8, cl_crosshair_recoil: 0, cl_crosshair_drawoutline: 1,
      cl_crosshairdot: 1, cl_crosshair_t: 0,
      cl_crosshaircolor_r: 124, cl_crosshaircolor_g: 57, cl_crosshaircolor_b: 57, cl_crosshaircolor_a: 255,
      cl_crosshairoutline_r: 0, cl_crosshairoutline_g: 0, cl_crosshairoutline_b: 0, cl_crosshairoutline_a: 255,
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
      cl_crosshairoutline_r: 0, cl_crosshairoutline_g: 0, cl_crosshairoutline_b: 0, cl_crosshairoutline_a: 255,
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
      cl_crosshairoutline_r: 0, cl_crosshairoutline_g: 0, cl_crosshairoutline_b: 0, cl_crosshairoutline_a: 255,
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
      cl_crosshairoutline_r: 0, cl_crosshairoutline_g: 0, cl_crosshairoutline_b: 0, cl_crosshairoutline_a: 255,
      cl_crosshair_gap: 4, cl_crosshair_length: 8, cl_crosshair_thickness: 2,
      cl_crosshair_dynamic_spread_limit: 255, cl_crosshair_dynamic_splitdist: 7,
      cl_crosshair_dynamic_splitalpha_innermod: 1, cl_crosshair_dynamic_splitalpha_outermod: 0.4,
      cl_crosshair_dynamic_maxdist_splitratio: 0.3, cl_crosshair_screen_height: 1080,
    },
  },
];

test('decodes old V4 share codes (akiver test vectors) with the outline conversion of the game', async () => {
  const { decode } = await load();
  for (const { code, params } of V4) {
    const res = decode(code);
    assert.ok(res, `decode failed for ${code}`);
    assert.equal(res.format, 'CSGO');
    assert.equal(res.version, 4);
    assert.deepEqual(res.params, params);
  }
});

test('decodes old V3 share codes (outline as bool)', async () => {
  const { decode } = await load();
  for (const { code, params } of V3) {
    const res = decode(code);
    assert.ok(res, `decode failed for ${code}`);
    assert.equal(res.version, 3);
    assert.deepEqual(res.params, params);
  }
});

test('old V3/V4 codes re-encode into the new format and keep their values', async () => {
  const { encode, decode } = await load();
  for (const { code, params } of [...V3, ...V4]) {
    const viaOld = decode(code).params;
    const { code: neu, clamped } = encode(viaOld);
    assert.deepEqual(clamped, []);
    const res = decode(neu);
    assert.equal(res.format, 'CS');
    // Scope-Dot-Felder kennt der alte Code nicht -> Defaults im neuen Code
    assert.deepEqual(res.params, {
      ...params, cl_ironsight_usecrosshaircolor: 0, cl_ironsight_dot_scale: 1,
    });
  }
});

test('old code with translucent crosshair gets outline alpha = crosshair alpha', async () => {
  const { decode } = await load();
  // V1-Beispiel taugt hier nicht; V4-Vektor 1 hat Alpha 255. Byteweise gebauter V4-Code mit Alpha 128:
  const bytes = [0, 4, 0x04, 10, 20, 30, 128, 4, 8, 255, 3, 0x00, 0x00, 0x11, 0x38, 0x04, 0, 0];
  let sum = 0; for (let i = 1; i < 18; i++) sum = (sum + bytes[i]) & 0xff;
  bytes[0] = sum;
  const DICT = 'ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789';
  let big = 0n; for (const b of bytes) big = (big << 8n) | BigInt(b);
  let chars = ''; for (let i = 0; i < 25; i++) { chars += DICT[Number(big % 57n)]; big /= 57n; }
  const code = `CSGO-${chars.slice(0, 5)}-${chars.slice(5, 10)}-${chars.slice(10, 15)}-${chars.slice(15, 20)}-${chars.slice(20)}`;
  const res = decode(code);
  assert.equal(res.version, 4);
  assert.equal(res.params.cl_crosshaircolor_a, 128);
  assert.equal(res.params.cl_crosshairoutline_a, 128);
  assert.equal(res.params.cl_crosshair_drawoutline, 1);
  assert.equal(res.params.cl_crosshair_thickness, 2);
});

test('decodes legacy V1 codes with old cvar names and legacy flag', async () => {
  const { decode } = await load();
  // akiver V1 crosshair sample
  const res = decode('CSGO-Cn37R-YE7vo-pLCAL-aURmZ-z6zkG');
  assert.ok(res);
  assert.equal(res.format, 'CSGO');
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
  assert.equal(decode('CSGO-eRqP8-AkrwM-3Wsqh-pKDTh-eAPtQ'), null); // gueltige Pruefsumme, unbekannte Version 2
  assert.equal(decode(''), null);
  assert.equal(decode(null), null);
});

test('old format: checksum covers bytes 1..15 only and any version >= 3 decodes (as in the game)', async () => {
  const { decode } = await load();
  const DICT = 'ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789';
  const toCode = (bytes) => {
    let big = 0n; for (const b of bytes) big = (big << 8n) | BigInt(b);
    let chars = ''; for (let i = 0; i < 25; i++) { chars += DICT[Number(big % 57n)]; big /= 57n; }
    return `CSGO-${chars.slice(0, 5)}-${chars.slice(5, 10)}-${chars.slice(10, 15)}-${chars.slice(15, 20)}-${chars.slice(20)}`;
  };
  const sum15 = (b) => { let s = 0; for (let i = 1; i < 16; i++) s = (s + b[i]) & 0xff; return s; };
  // Version 7, innermod-Rohwert 30 (-> 150 & 0x7f = 22 -> 0.22), Bytes 16/17 belegt
  const bits = (3 | (30 << 7) | (4 << 12) | (50 << 16) | (5 << 23) | (2 << 28)) >>> 0;
  const b = [0, 7, 0x04 | 0x10, 1, 2, 3, 200, 9, 8, 77, bits & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, (bits >>> 24) & 0xff, 0x38, 0x04, 0xaa, 0xbb];
  b[0] = sum15(b);
  const res = decode(toCode(b));
  assert.ok(res);
  assert.equal(res.version, 7);
  assert.equal(res.params.cl_crosshair_drawoutline, 2);
  assert.equal(res.params.cl_crosshair_recoil, 1);
  assert.equal(res.params.cl_crosshair_dynamic_splitalpha_innermod, 0.22);
  assert.equal(res.params.cl_crosshair_dynamic_splitalpha_outermod, 0.5);
  assert.equal(res.params.cl_crosshair_thickness, 5);
  // Pruefsumme ueber alle 17 Bytes (wie akiver) waere hier falsch -> das Spiel prueft nur 1..15
  const wrong = [...b]; wrong[0] = (wrong[0] + 1) & 0xff;
  assert.equal(decode(toCode(wrong)), null);
});
