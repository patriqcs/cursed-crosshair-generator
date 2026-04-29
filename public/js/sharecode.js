// CS:GO / CS2 crosshair share code encoder + decoder.
// Format: CSGO-AAAAA-BBBBB-CCCCC-DDDDD-EEEEE
// Reference: https://github.com/akiver/csgo-sharecode (MIT)
//
// 18-byte layout:
//   [0]  checksum   = sum(bytes[1..17]) & 0xFF
//   [1]  version    = 1
//   [2]  gap        = int8, value * 10  (range -12.8 .. 12.7)
//   [3]  outline    = uint8, value * 2  (range 0 .. 3)
//   [4]  red        = uint8 (0..255)
//   [5]  green      = uint8 (0..255)
//   [6]  blue       = uint8 (0..255)
//   [7]  alpha      = uint8 (0..255)
//   [8]  splitDist+recoil  bits 0..2: dyn_splitdist & 7
//                          bit 7: recoil
//   [9]  fixedGap   = int8, value * 10
//   [10] color+outlineEnabled+innerSplit
//        bits 0..2: cl_crosshaircolor & 7
//        bit 3:     drawoutline
//        bits 4..7: (innerSplitAlpha * 10) & 0xF
//   [11] outerSplit+splitRatio
//        bits 0..3: (outerSplitAlpha * 10) & 0xF
//        bits 4..7: (splitSizeRatio * 10) & 0xF
//   [12] thickness  = uint8, value * 10  (range 0 .. 25.5)
//   [13] style+flags
//        bits 0..3: style << 1
//        bit 4:     dot
//        bit 5:     gap_useweaponvalue
//        bit 6:     usealpha
//        bit 7:     t_style
//   [14] size       = uint8, value * 10  (range 0 .. 25.5)
//   [15..17] reserved (zero)
//
// Note: Many "cursed" param values exceed what the share code can represent
// (e.g. size > 25.5, gap > 12.7). Such values are clamped on encode and the
// caller is informed via the returned `clamped` array.

const DICT = 'ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789';
// Note: omits I, l, 0, 1, AND lowercase g (per akiver).

const SHARECODE_LIMITS = Object.freeze({
  size: { min: 0, max: 25.5 },
  thickness: { min: 0, max: 25.5 },
  gap: { min: -12.8, max: 12.7 },
  fixedGap: { min: -12.8, max: 12.7 },
  outlineThickness: { min: 0, max: 3 },
  splitDist: { min: 0, max: 7 },
  innerSplitAlpha: { min: 0, max: 1.5 },
  outerSplitAlpha: { min: 0, max: 1.5 },
  splitSizeRatio: { min: 0, max: 1.5 },
});

function clamp(n, min, max) { return Math.min(Math.max(n, min), max); }
function toU8(n) { return n & 0xff; }
function toI8(n) { return n < 0 ? (n + 256) & 0xff : n & 0xff; }
function fromI8(n) { return n > 0x7f ? n - 256 : n; }

function trackClamp(list, key, original, clamped) {
  if (Number.isFinite(original) && original !== clamped) {
    list.push({ key, from: original, to: clamped });
  }
}

export function encode(params, opts = {}) {
  const clamped = [];
  const p = params || {};

  const gap = clamp(p.cl_crosshairgap ?? 0, SHARECODE_LIMITS.gap.min, SHARECODE_LIMITS.gap.max);
  trackClamp(clamped, 'cl_crosshairgap', p.cl_crosshairgap, gap);

  const outline = clamp(p.cl_crosshair_outlinethickness ?? 0, SHARECODE_LIMITS.outlineThickness.min, SHARECODE_LIMITS.outlineThickness.max);
  trackClamp(clamped, 'cl_crosshair_outlinethickness', p.cl_crosshair_outlinethickness, outline);

  const r = clamp(Math.round(p.cl_crosshaircolor_r ?? 0), 0, 255);
  const g = clamp(Math.round(p.cl_crosshaircolor_g ?? 0), 0, 255);
  const b = clamp(Math.round(p.cl_crosshaircolor_b ?? 0), 0, 255);
  const alpha = clamp(Math.round(p.cl_crosshairalpha ?? 255), 0, 255);

  const sd = clamp(Math.round(p.cl_crosshair_dynamic_splitdist ?? 0), SHARECODE_LIMITS.splitDist.min, SHARECODE_LIMITS.splitDist.max);
  trackClamp(clamped, 'cl_crosshair_dynamic_splitdist', p.cl_crosshair_dynamic_splitdist, sd);

  const recoil = (p.cl_crosshair_recoil ?? 0) ? 1 : 0;

  const fixedGap = clamp(p.cl_fixedcrosshairgap ?? 0, SHARECODE_LIMITS.fixedGap.min, SHARECODE_LIMITS.fixedGap.max);
  trackClamp(clamped, 'cl_fixedcrosshairgap', p.cl_fixedcrosshairgap, fixedGap);

  const colorIdx = clamp(Math.round(p.cl_crosshaircolor ?? 5), 0, 7);
  const drawOutline = (p.cl_crosshair_drawoutline ?? 0) ? 1 : 0;

  const innerSplit = clamp(p.cl_crosshair_dynamic_splitalpha_innermod ?? 0, SHARECODE_LIMITS.innerSplitAlpha.min, SHARECODE_LIMITS.innerSplitAlpha.max);
  trackClamp(clamped, 'cl_crosshair_dynamic_splitalpha_innermod', p.cl_crosshair_dynamic_splitalpha_innermod, innerSplit);

  const outerSplit = clamp(p.cl_crosshair_dynamic_splitalpha_outermod ?? 0, SHARECODE_LIMITS.outerSplitAlpha.min, SHARECODE_LIMITS.outerSplitAlpha.max);
  trackClamp(clamped, 'cl_crosshair_dynamic_splitalpha_outermod', p.cl_crosshair_dynamic_splitalpha_outermod, outerSplit);

  const splitRatio = clamp(p.cl_crosshair_dynamic_maxdist_splitratio ?? 0, SHARECODE_LIMITS.splitSizeRatio.min, SHARECODE_LIMITS.splitSizeRatio.max);
  trackClamp(clamped, 'cl_crosshair_dynamic_maxdist_splitratio', p.cl_crosshair_dynamic_maxdist_splitratio, splitRatio);

  const thickness = clamp(p.cl_crosshairthickness ?? 0, SHARECODE_LIMITS.thickness.min, SHARECODE_LIMITS.thickness.max);
  trackClamp(clamped, 'cl_crosshairthickness', p.cl_crosshairthickness, thickness);

  const style = clamp(Math.round(p.cl_crosshairstyle ?? 4), 0, 5);
  const dot = (p.cl_crosshairdot ?? 0) ? 1 : 0;
  const useWeaponGap = (p.cl_crosshairgap_useweaponvalue ?? 0) ? 1 : 0;
  const useAlpha = (p.cl_crosshairusealpha ?? 0) ? 1 : 0;
  const tStyle = (p.cl_crosshair_t ?? 0) ? 1 : 0;

  const size = clamp(p.cl_crosshairsize ?? 0, SHARECODE_LIMITS.size.min, SHARECODE_LIMITS.size.max);
  trackClamp(clamped, 'cl_crosshairsize', p.cl_crosshairsize, size);

  const bytes = new Uint8Array(18);
  bytes[1] = 1;
  bytes[2] = toI8(Math.round(gap * 10));
  bytes[3] = toU8(Math.round(outline * 2));
  bytes[4] = r;
  bytes[5] = g;
  bytes[6] = b;
  bytes[7] = alpha;
  bytes[8] = (sd & 7) | (recoil << 7);
  bytes[9] = toI8(Math.round(fixedGap * 10));
  bytes[10] = (colorIdx & 7) | ((drawOutline & 1) << 3) | ((Math.round(innerSplit * 10) & 0xf) << 4);
  bytes[11] = ((Math.round(outerSplit * 10)) & 0xf) | (((Math.round(splitRatio * 10)) & 0xf) << 4);
  bytes[12] = toU8(Math.round(thickness * 10));
  bytes[13] = ((style << 1) & 0xf) | ((dot & 1) << 4) | ((useWeaponGap & 1) << 5) | ((useAlpha & 1) << 6) | ((tStyle & 1) << 7);
  bytes[14] = toU8(Math.round(size * 10));
  // bytes[15..17] = 0

  let sum = 0;
  for (let i = 1; i < 18; i++) sum = (sum + bytes[i]) & 0xff;
  bytes[0] = sum;

  // Big-endian bigint of bytes
  let big = 0n;
  for (let i = 0; i < 18; i++) big = (big << 8n) | BigInt(bytes[i]);

  // Base57 encode (low digit first)
  let chars = '';
  for (let i = 0; i < 25; i++) {
    chars += DICT[Number(big % 57n)];
    big = big / 57n;
  }

  const code = `CSGO-${chars.slice(0, 5)}-${chars.slice(5, 10)}-${chars.slice(10, 15)}-${chars.slice(15, 20)}-${chars.slice(20, 25)}`;
  return { code, clamped };
}

export function decode(code) {
  if (typeof code !== 'string') return null;
  const stripped = code.replace(/^CSGO/i, '').replace(/-/g, '').trim();
  if (stripped.length !== 25) return null;

  // Validate alphabet
  for (const ch of stripped) {
    if (DICT.indexOf(ch) === -1) return null;
  }

  // Reverse chars and base57-decode
  let big = 0n;
  for (let i = stripped.length - 1; i >= 0; i--) {
    big = big * 57n + BigInt(DICT.indexOf(stripped[i]));
  }

  // bigint -> 18 bytes (big-endian)
  const bytes = new Uint8Array(18);
  for (let i = 17; i >= 0; i--) {
    bytes[i] = Number(big & 0xffn);
    big = big >> 8n;
  }

  // Verify checksum
  let sum = 0;
  for (let i = 1; i < 18; i++) sum = (sum + bytes[i]) & 0xff;
  if (sum !== bytes[0]) return null;

  // Decode fields
  const params = {
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
  return params;
}

export const SHARECODE_INFO = SHARECODE_LIMITS;
