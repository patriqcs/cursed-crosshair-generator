// CS2 crosshair share code encoder + decoder.
// Format: CSGO-AAAAA-BBBBB-CCCCC-DDDDD-EEEEE (25 Zeichen Base57 -> 18 Bytes big-endian).
// Referenz: https://github.com/akiver/csgo-sharecode (MIT), v6.0.0 (2026-09-24),
// verifiziert gegen dessen Testvektoren (test/sharecode.test.js).
//
// Byte 0 = Pruefsumme sum(bytes[1..17]) & 0xFF, Byte 1 = Version.
//   Version 1: altes CS:GO/CS2-Layout (bis 1.41.8.1). Wird vom CS2-Client seit dem
//              Update vom 2026-09-23 abgelehnt; hier nur noch zum Importieren/Migrieren.
//   Version 3: Pixel-Layout (1.41.8.2, 2026-09-23), Outline als Bool in Byte 2 Bit 5.
//   Version 4: Pixel-Layout (1.41.8.3, 2026-09-24), Outline-Modus 0/1/2 in Bits 28..29.
//
// Pixel-Layout (V3/V4), Bytes 2..17:
//   [2]  bits 0..3 style | bit 4 recoil | bit 5 outline (nur V3) | bit 6 dot | bit 7 t-style
//   [3..6]  r, g, b, a
//   [7]  gap (0..255, Cvar-Max 128)   [8] length (0..255)   [9] dynamic_spread_limit (0..255)
//   [10..13] uint32 little-endian Bitfeld:
//        bits 0..6   splitdist (0..127)
//        bits 7..11  innermod * 20            (0..20)
//        bits 12..15 outermod * 20 - 6        (0.3..1.0)
//        bits 16..22 splitratio * 100         (0..100)
//        bits 23..27 thickness (0..31)
//        bits 28..29 outline mode (nur V4)    0 none, 1 full, 2 half
//   [14..15] screen_height uint16 little-endian
//   [16..17] 0

const DICT = 'ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789';

export const SHARECODE_LIMITS = Object.freeze({
  cl_crosshair_gap: { min: 0, max: 255 },
  cl_crosshair_length: { min: 0, max: 255 },
  cl_crosshair_thickness: { min: 0, max: 31 },
  cl_crosshair_dynamic_spread_limit: { min: 0, max: 255 },
  cl_crosshair_dynamic_splitdist: { min: 0, max: 127 },
  cl_crosshair_dynamic_splitalpha_innermod: { min: 0, max: 1 },
  cl_crosshair_dynamic_splitalpha_outermod: { min: 0.3, max: 1 },
  cl_crosshair_dynamic_maxdist_splitratio: { min: 0, max: 1 },
  cl_crosshair_screen_height: { min: 0, max: 65535 },
});

function clamp(n, min, max) { return Math.min(Math.max(n, min), max); }
function fromI8(n) { return n > 0x7f ? n - 256 : n; }
function num(v, dflt) { const n = Number(v); return Number.isFinite(n) ? n : dflt; }
function bool01(v) { return (v === 1 || v === true || v === '1' || v === 'true') ? 1 : 0; }

function trackClamp(list, key, original, clamped) {
  if (Number.isFinite(original) && original !== clamped) list.push({ key, from: original, to: clamped });
}

function bytesToCode(bytes) {
  let sum = 0;
  for (let i = 1; i < 18; i++) sum = (sum + bytes[i]) & 0xff;
  bytes[0] = sum;
  let big = 0n;
  for (let i = 0; i < 18; i++) big = (big << 8n) | BigInt(bytes[i]);
  let chars = '';
  for (let i = 0; i < 25; i++) { chars += DICT[Number(big % 57n)]; big /= 57n; }
  return `CSGO-${chars.slice(0, 5)}-${chars.slice(5, 10)}-${chars.slice(10, 15)}-${chars.slice(15, 20)}-${chars.slice(20, 25)}`;
}

function codeToBytes(code) {
  if (typeof code !== 'string') return null;
  const m = /^\s*CSGO(?:-([A-Za-z0-9]{5})){5}\s*$/.exec(code);
  if (!m) return null;
  const stripped = code.trim().slice(5).replace(/-/g, '');
  for (const ch of stripped) if (DICT.indexOf(ch) === -1) return null;
  let big = 0n;
  for (let i = stripped.length - 1; i >= 0; i--) big = big * 57n + BigInt(DICT.indexOf(stripped[i]));
  const bytes = new Uint8Array(18);
  for (let i = 17; i >= 0; i--) { bytes[i] = Number(big & 0xffn); big >>= 8n; }
  let sum = 0;
  for (let i = 1; i < 18; i++) sum = (sum + bytes[i]) & 0xff;
  if (sum !== bytes[0]) return null;
  return bytes;
}

// Encode params (neue Cvar-Namen) als V4-Code. Werte ausserhalb des kodierbaren
// Bereichs werden geclampt und in `clamped` gemeldet.
export function encode(params) {
  const p = params || {};
  const clamped = [];
  const L = SHARECODE_LIMITS;
  const c = (key, dflt, min, max) => {
    const raw = num(p[key], dflt);
    const v = clamp(raw, min, max);
    trackClamp(clamped, key, raw, v);
    return v;
  };

  const style = clamp(Math.round(num(p.cl_crosshairstyle, 4)), 0, 8);
  const recoil = bool01(p.cl_crosshair_recoil);
  const dot = bool01(p.cl_crosshairdot);
  const tStyle = bool01(p.cl_crosshair_t);
  const outlineMode = clamp(Math.round(num(p.cl_crosshair_drawoutline, 1)), 0, 2);

  const r = clamp(Math.round(num(p.cl_crosshaircolor_r, 0)), 0, 255);
  const g = clamp(Math.round(num(p.cl_crosshaircolor_g, 255)), 0, 255);
  const b = clamp(Math.round(num(p.cl_crosshaircolor_b, 0)), 0, 255);
  const a = clamp(Math.round(num(p.cl_crosshaircolor_a, 255)), 0, 255);

  const gap = Math.round(c('cl_crosshair_gap', 4, L.cl_crosshair_gap.min, L.cl_crosshair_gap.max));
  const length = Math.round(c('cl_crosshair_length', 8, L.cl_crosshair_length.min, L.cl_crosshair_length.max));
  const spread = Math.round(c('cl_crosshair_dynamic_spread_limit', 255, 0, 255));
  const splitDist = Math.round(c('cl_crosshair_dynamic_splitdist', 3, 0, 127));
  // Gerundet statt truncated (wie akiver), damit 0.29*100 = 28.999... nicht kippt.
  const inner = Math.round(c('cl_crosshair_dynamic_splitalpha_innermod', 0, 0, 1) * 20);
  const outer = Math.round(c('cl_crosshair_dynamic_splitalpha_outermod', 1, 0.3, 1) * 20) - 6;
  const ratio = Math.round(c('cl_crosshair_dynamic_maxdist_splitratio', 1, 0, 1) * 100);
  const thickness = Math.round(c('cl_crosshair_thickness', 2, 0, 31));
  const screenH = Math.round(c('cl_crosshair_screen_height', 1080, 0, 65535));

  const bits = (splitDist | (inner << 7) | (outer << 12) | (ratio << 16) | (thickness << 23) | (outlineMode << 28)) >>> 0;

  const bytes = new Uint8Array(18);
  bytes[1] = 4;
  bytes[2] = style | (recoil << 4) | (dot << 6) | (tStyle << 7);
  bytes[3] = r; bytes[4] = g; bytes[5] = b; bytes[6] = a;
  bytes[7] = gap; bytes[8] = length; bytes[9] = spread;
  bytes[10] = bits & 0xff;
  bytes[11] = (bits >>> 8) & 0xff;
  bytes[12] = (bits >>> 16) & 0xff;
  bytes[13] = (bits >>> 24) & 0xff;
  bytes[14] = screenH & 0xff;
  bytes[15] = (screenH >> 8) & 0xff;
  return { code: bytesToCode(bytes), clamped };
}

function decodePixel(bytes, version) {
  const bits = (bytes[10] | (bytes[11] << 8) | (bytes[12] << 16) | (bytes[13] << 24)) >>> 0;
  const params = {
    cl_crosshairstyle: bytes[2] & 0xf,
    cl_crosshair_recoil: (bytes[2] >> 4) & 1,
    cl_crosshairdot: (bytes[2] >> 6) & 1,
    cl_crosshair_t: (bytes[2] >> 7) & 1,
    cl_crosshaircolor_r: bytes[3],
    cl_crosshaircolor_g: bytes[4],
    cl_crosshaircolor_b: bytes[5],
    cl_crosshaircolor_a: bytes[6],
    cl_crosshair_gap: bytes[7],
    cl_crosshair_length: bytes[8],
    cl_crosshair_dynamic_spread_limit: bytes[9],
    cl_crosshair_dynamic_splitdist: bits & 0x7f,
    cl_crosshair_dynamic_splitalpha_innermod: ((bits >>> 7) & 0x1f) / 20,
    cl_crosshair_dynamic_splitalpha_outermod: (((bits >>> 12) & 0xf) + 6) / 20,
    cl_crosshair_dynamic_maxdist_splitratio: ((bits >>> 16) & 0x7f) / 100,
    cl_crosshair_thickness: (bits >>> 23) & 0x1f,
    cl_crosshair_screen_height: bytes[14] | (bytes[15] << 8),
  };
  params.cl_crosshair_drawoutline = version === 3
    ? (bytes[2] >> 5) & 1
    : (bits >>> 28) & 3;
  return params;
}

// Altes Layout (V1) — liefert die ALTEN Cvar-Namen; der Aufrufer muss migrieren.
function decodeV1(bytes) {
  return {
    cl_crosshairgap: fromI8(bytes[2]) / 10,
    cl_crosshair_outlinethickness: bytes[3] / 2,
    cl_crosshaircolor_r: bytes[4],
    cl_crosshaircolor_g: bytes[5],
    cl_crosshaircolor_b: bytes[6],
    cl_crosshairalpha: bytes[7],
    cl_crosshair_dynamic_splitdist: bytes[8] & 7,
    cl_crosshair_recoil: (bytes[8] >> 7) & 1,
    cl_fixedcrosshairgap: fromI8(bytes[9]) / 10,
    cl_crosshaircolor: bytes[10] & 7,
    cl_crosshair_drawoutline: (bytes[10] >> 3) & 1,
    cl_crosshair_dynamic_splitalpha_innermod: ((bytes[10] >> 4) & 0xf) / 10,
    cl_crosshair_dynamic_splitalpha_outermod: (bytes[11] & 0xf) / 10,
    cl_crosshair_dynamic_maxdist_splitratio: ((bytes[11] >> 4) & 0xf) / 10,
    cl_crosshairthickness: bytes[12] / 10,
    cl_crosshairstyle: (bytes[13] & 0xf) >> 1,
    cl_crosshairdot: (bytes[13] >> 4) & 1,
    cl_crosshairgap_useweaponvalue: (bytes[13] >> 5) & 1,
    cl_crosshairusealpha: (bytes[13] >> 6) & 1,
    cl_crosshair_t: (bytes[13] >> 7) & 1,
    cl_crosshairsize: bytes[14] / 10,
  };
}

// decode(code) -> { version, params } | null
//   version 3/4: params mit neuen Cvar-Namen
//   version 1:   params mit ALTEN Cvar-Namen (legacy: true)
export function decode(code) {
  const bytes = codeToBytes(code);
  if (!bytes) return null;
  switch (bytes[1]) {
    case 1: return { version: 1, legacy: true, params: decodeV1(bytes) };
    case 3: return { version: 3, params: decodePixel(bytes, 3) };
    case 4: return { version: 4, params: decodePixel(bytes, 4) };
    default: return null;
  }
}
