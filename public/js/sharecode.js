// CS2 crosshair share code encoder + decoder.
//
// Seit CS2 1.41.8.8 (Build 2000922, 2026-09-30) erzeugt das Spiel ein NEUES Format:
//   "CS" + 44 Zeichen Base57 (46 Zeichen, keine Bindestriche) -> 32 Bytes big-endian.
// Layout aus dem Decompilat von libclient.so (Encoder VMA 1bec400, Decoder 1bec860),
// siehe ~/projects/cs2-re/NOTES.md. Byte 0 = Pruefsumme sum(bytes[1..31]) & 0xFF.
//   [1]      Version = 1
//   [2..3]   screen_height uint16 little-endian (Decoder verlangt != 0, clampt auf >= 240)
//   [4]      style Bits 0..4 (0..9) | recoil Bit 5 | dot Bit 6 | t-style Bit 7
//   [5..8]   r, g, b, a                [9..12] Outline r, g, b, a
//   [13]     thickness Bits 0..5 (0..32) | outline mode Bits 6..7 (0 none, 1 full, 2 half)
//   [14..15] gap int16 little-endian (-3840..3840)
//   [16]     length (0..255)           [17] dynamic_spread_limit (0..255)
//   [18..21] uint32 little-endian Bitfeld:
//        bits 0..6    splitdist (0..127)
//        bits 7..13   innermod * 100          (0..100)
//        bits 14..20  (outermod - 0.3) * 100  (0..70)
//        bits 21..27  splitratio * 100        (0..100)
//        bit  28      cl_ironsight_usecrosshaircolor
//   [22]     (cl_ironsight_dot_scale - 0.1) * 100 (0..190)
//   [23..31] 0
//
// Altes Format: CSGO-AAAAA-BBBBB-CCCCC-DDDDD-EEEEE (25 Zeichen Base57 -> 18 Bytes),
// Referenz akiver/csgo-sharecode v6.0.0. Byte 0 = Pruefsumme sum(bytes[1..17]), Byte 1 = Version.
//   Version 1: Layout vor dem Update vom 2026-09-22. Vom Spiel abgelehnt; hier nur zum Migrieren.
//   Version 3/4 (das Spiel behandelt jede Version > 3 wie 4): Pixel-Layout vom 23./24.09.2026. Das Spiel importiert sie weiterhin und setzt dabei
//              Outline-Farbe = Schwarz mit Outline-Alpha = Crosshair-Alpha; decode() macht dasselbe.
//   Pixel-Layout (V3/V4), Bytes 2..17:
//   [2]  bits 0..3 style | bit 4 recoil | bit 5 outline (nur V3) | bit 6 dot | bit 7 t-style
//   [3..6]  r, g, b, a   [7] gap (0..255)   [8] length   [9] dynamic_spread_limit
//   [10..13] uint32 LE: splitdist 0..6 | innermod*20 7..11 | outermod*20-6 12..15 |
//            splitratio*100 16..22 | thickness 23..27 | outline mode 28..29 (nur V4)
//   [14..15] screen_height uint16 little-endian
// encode() erzeugt nur noch das neue Format.

const DICT = 'ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789';

// Kodierbare Bereiche des neuen Formats (decken sich mit den Cvar-Ranges).
export const SHARECODE_LIMITS = Object.freeze({
  cl_crosshair_gap: { min: -3840, max: 3840 },
  cl_crosshair_length: { min: 0, max: 255 },
  cl_crosshair_thickness: { min: 0, max: 32 },
  cl_crosshair_dynamic_spread_limit: { min: 0, max: 255 },
  cl_crosshair_dynamic_splitdist: { min: 0, max: 127 },
  cl_crosshair_dynamic_splitalpha_innermod: { min: 0, max: 1 },
  cl_crosshair_dynamic_splitalpha_outermod: { min: 0.3, max: 1 },
  cl_crosshair_dynamic_maxdist_splitratio: { min: 0, max: 1 },
  cl_ironsight_dot_scale: { min: 0.1, max: 2 },
  cl_crosshair_screen_height: { min: 240, max: 65535 },
});

const NEW_BYTES = 32;
const NEW_CHARS = 44;
const OLD_BYTES = 18;

function clamp(n, min, max) { return Math.min(Math.max(n, min), max); }
function fromI8(n) { return n > 0x7f ? n - 256 : n; }
function num(v, dflt) { const n = Number(v); return Number.isFinite(n) ? n : dflt; }
function bool01(v) { return (v === 1 || v === true || v === '1' || v === 'true') ? 1 : 0; }

function trackClamp(list, key, original, clamped) {
  if (Number.isFinite(original) && original !== clamped) list.push({ key, from: original, to: clamped });
}

function checksum(bytes, end = bytes.length) {
  let sum = 0;
  for (let i = 1; i < end; i++) sum = (sum + bytes[i]) & 0xff;
  return sum;
}

// roundf(x / 0.01f) bzw. roundf((x - min) / 0.01f) in float32, wie der Encoder des Spiels.
// Auf dem 0.01-Raster identisch mit round(x * 100) - min * 100.
const F = Math.fround;
function steps01(x, min = 0) {
  return Math.round(F(F(F(x) - F(min)) / F(0.01)));
}

// Bytes (big-endian Zahl) -> Base57-Ziffern, niederwertigste zuerst.
function bytesToDigits(bytes, count) {
  let big = 0n;
  for (let i = 0; i < bytes.length; i++) big = (big << 8n) | BigInt(bytes[i]);
  let chars = '';
  for (let i = 0; i < count; i++) { chars += DICT[Number(big % 57n)]; big /= 57n; }
  return chars;
}

// Base57-Ziffern -> Bytes; null bei fremden Zeichen oder Ueberlauf.
function digitsToBytes(chars, byteCount) {
  let big = 0n;
  for (let i = chars.length - 1; i >= 0; i--) {
    const d = DICT.indexOf(chars[i]);
    if (d === -1) return null;
    big = big * 57n + BigInt(d);
  }
  if (big >> BigInt(byteCount * 8) !== 0n) return null;
  const bytes = new Uint8Array(byteCount);
  for (let i = byteCount - 1; i >= 0; i--) { bytes[i] = Number(big & 0xffn); big >>= 8n; }
  return bytes;
}

// Encode params als Code im neuen Format. Werte ausserhalb des kodierbaren
// Bereichs werden geclampt und in `clamped` gemeldet.
export function encode(params) {
  const p = params || {};
  const clamped = [];
  const L = SHARECODE_LIMITS;
  const c = (key, dflt) => {
    const raw = num(p[key], dflt);
    const v = clamp(raw, L[key].min, L[key].max);
    trackClamp(clamped, key, raw, v);
    return v;
  };
  const u8 = (key, dflt) => clamp(Math.round(num(p[key], dflt)), 0, 255);

  const style = clamp(Math.round(num(p.cl_crosshairstyle, 4)), 0, 9);
  const recoil = bool01(p.cl_crosshair_recoil);
  const dot = bool01(p.cl_crosshairdot);
  const tStyle = bool01(p.cl_crosshair_t);
  const outlineMode = clamp(Math.round(num(p.cl_crosshair_drawoutline, 1)), 0, 2);

  const gap = Math.round(c('cl_crosshair_gap', 4));
  const length = Math.round(c('cl_crosshair_length', 8));
  const thickness = Math.round(c('cl_crosshair_thickness', 2));
  const spread = Math.round(c('cl_crosshair_dynamic_spread_limit', 255));
  const splitDist = Math.round(c('cl_crosshair_dynamic_splitdist', 3));
  const inner = steps01(c('cl_crosshair_dynamic_splitalpha_innermod', 0));
  const outer = steps01(c('cl_crosshair_dynamic_splitalpha_outermod', 1), 0.3);
  const ratio = steps01(c('cl_crosshair_dynamic_maxdist_splitratio', 1));
  const scopeColor = bool01(p.cl_ironsight_usecrosshaircolor);
  const scopeScale = steps01(c('cl_ironsight_dot_scale', 1), 0.1);
  const screenH = Math.round(c('cl_crosshair_screen_height', 1080));

  const bits = (splitDist | (inner << 7) | (outer << 14) | (ratio << 21) | (scopeColor << 28)) >>> 0;
  const gap16 = gap & 0xffff;

  const bytes = new Uint8Array(NEW_BYTES);
  bytes[1] = 1;
  bytes[2] = screenH & 0xff;
  bytes[3] = (screenH >> 8) & 0xff;
  bytes[4] = style | (recoil << 5) | (dot << 6) | (tStyle << 7);
  bytes[5] = u8('cl_crosshaircolor_r', 0);
  bytes[6] = u8('cl_crosshaircolor_g', 255);
  bytes[7] = u8('cl_crosshaircolor_b', 0);
  bytes[8] = u8('cl_crosshaircolor_a', 255);
  bytes[9] = u8('cl_crosshairoutline_r', 0);
  bytes[10] = u8('cl_crosshairoutline_g', 0);
  bytes[11] = u8('cl_crosshairoutline_b', 0);
  bytes[12] = u8('cl_crosshairoutline_a', 255);
  bytes[13] = thickness | (outlineMode << 6);
  bytes[14] = gap16 & 0xff;
  bytes[15] = (gap16 >> 8) & 0xff;
  bytes[16] = length;
  bytes[17] = spread;
  bytes[18] = bits & 0xff;
  bytes[19] = (bits >>> 8) & 0xff;
  bytes[20] = (bits >>> 16) & 0xff;
  bytes[21] = (bits >>> 24) & 0xff;
  bytes[22] = scopeScale;
  bytes[0] = checksum(bytes);
  return { code: `CS${bytesToDigits(bytes, NEW_CHARS)}`, clamped };
}

// Neues Format -> Params. Clamps wie der Decoder des Spiels.
function decodeNew(bytes) {
  if (bytes[1] !== 1) return null;
  const screenH = bytes[2] | (bytes[3] << 8);
  if (screenH === 0) return null;
  const bits = (bytes[18] | (bytes[19] << 8) | (bytes[20] << 16) | (bytes[21] << 24)) >>> 0;
  const gapRaw = bytes[14] | (bytes[15] << 8);
  const gap = gapRaw > 0x7fff ? gapRaw - 0x10000 : gapRaw;
  return {
    cl_crosshairstyle: Math.min(bytes[4] & 0x1f, 9),
    cl_crosshair_recoil: (bytes[4] >> 5) & 1,
    cl_crosshairdot: (bytes[4] >> 6) & 1,
    cl_crosshair_t: (bytes[4] >> 7) & 1,
    cl_crosshaircolor_r: bytes[5],
    cl_crosshaircolor_g: bytes[6],
    cl_crosshaircolor_b: bytes[7],
    cl_crosshaircolor_a: bytes[8],
    cl_crosshairoutline_r: bytes[9],
    cl_crosshairoutline_g: bytes[10],
    cl_crosshairoutline_b: bytes[11],
    cl_crosshairoutline_a: bytes[12],
    cl_crosshair_thickness: Math.min(bytes[13] & 0x3f, 32),
    cl_crosshair_drawoutline: Math.min(bytes[13] >> 6, 2),
    cl_crosshair_gap: clamp(gap, -3840, 3840),
    cl_crosshair_length: bytes[16],
    cl_crosshair_dynamic_spread_limit: bytes[17],
    cl_crosshair_dynamic_splitdist: bits & 0x7f,
    cl_crosshair_dynamic_splitalpha_innermod: Math.min((bits >>> 7) & 0x7f, 100) / 100,
    cl_crosshair_dynamic_splitalpha_outermod: (Math.min((bits >>> 14) & 0x7f, 70) + 30) / 100,
    cl_crosshair_dynamic_maxdist_splitratio: Math.min((bits >>> 21) & 0x7f, 100) / 100,
    cl_ironsight_usecrosshaircolor: (bits >>> 28) & 1,
    cl_ironsight_dot_scale: (Math.min(bytes[22], 190) + 10) / 100,
    cl_crosshair_screen_height: Math.max(screenH, 240),
  };
}

// Altes Pixel-Layout (V3/V4). Outline-Farbe wie beim Import im Spiel: Schwarz mit der
// Deckkraft des Crosshairs. Die Scope-Dot-Werte kennt der alte Code nicht (das Spiel
// behaelt die aktuellen Cvars) — sie fehlen hier und bekommen beim Normalisieren Defaults.
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
    cl_crosshairoutline_r: 0,
    cl_crosshairoutline_g: 0,
    cl_crosshairoutline_b: 0,
    cl_crosshairoutline_a: bytes[6],
    cl_crosshair_gap: bytes[7],
    cl_crosshair_length: bytes[8],
    cl_crosshair_dynamic_spread_limit: bytes[9],
    cl_crosshair_dynamic_splitdist: bits & 0x7f,
    // Das Spiel rechnet die 0.05er-Schritte in 0.01er um (n * 5) und legt sie in 7-Bit-Feldern ab;
    // innermod-Rohwerte ueber 25 laufen dabei ueber (nur bei konstruierten Codes).
    cl_crosshair_dynamic_splitalpha_innermod: ((((bits >>> 7) & 0x1f) * 5) & 0x7f) / 100,
    cl_crosshair_dynamic_splitalpha_outermod: (((bits >>> 12) & 0xf) * 5 + 30) / 100,
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

// decode(code) -> { format, version, params } | null
//   format 'CS'   (version 1):   neues Format, params mit allen aktuellen Cvar-Namen
//   format 'CSGO' (version 3/4): altes Pixel-Layout, params wie im Spiel umgerechnet
//   format 'CSGO' (version 1):   params mit ALTEN Cvar-Namen (legacy: true), Aufrufer migriert
export function decode(code) {
  if (typeof code !== 'string') return null;
  const text = code.trim();

  if (/^CS[A-Za-z0-9]{44}$/.test(text)) {
    const bytes = digitsToBytes(text.slice(2), NEW_BYTES);
    if (!bytes || checksum(bytes) !== bytes[0]) return null;
    const params = decodeNew(bytes);
    return params ? { format: 'CS', version: 1, params } : null;
  }

  if (/^CSGO(?:-[A-Za-z0-9]{5}){5}$/.test(text)) {
    const bytes = digitsToBytes(text.slice(5).replace(/-/g, ''), OLD_BYTES);
    if (!bytes) return null;
    const version = bytes[1];
    if (version === 1) {
      if (checksum(bytes) !== bytes[0]) return null;
      return { format: 'CSGO', version: 1, legacy: true, params: decodeV1(bytes) };
    }
    // Wie der Decoder des Spiels (VMA 1bec860): Pruefsumme nur ueber die Bytes 1..15, Version 2
    // ungueltig, jede Version >= 3 gueltig — 3 mit Outline-Bool, alles darueber im V4-Layout.
    if (version < 3 || checksum(bytes, 16) !== bytes[0]) return null;
    return { format: 'CSGO', version, params: decodePixel(bytes, version === 3 ? 3 : 4) };
  }
  return null;
}
