'use strict';

// Format a number for cfg output. Integers render without decimals,
// floats keep up to 4 significant decimals and trim trailing zeros.
function fmtNum(n) {
  if (n === null || n === undefined) return '';
  if (Number.isInteger(n)) return String(n);
  const fixed = Number(n).toFixed(4);
  return fixed.replace(/0+$/, '').replace(/\.$/, '');
}

function buildPresetAliases(idx, preset) {
  const n = idx + 1;
  const p = preset.params;

  // _cN: style, size, thickness, gap, dot, t, recoil, then chain to _cNb
  const partA = [
    `cl_crosshairstyle ${fmtNum(p.cl_crosshairstyle)}`,
    `cl_crosshairsize ${fmtNum(p.cl_crosshairsize)}`,
    `cl_crosshairthickness ${fmtNum(p.cl_crosshairthickness)}`,
    `cl_crosshairgap ${fmtNum(p.cl_crosshairgap)}`,
    `cl_crosshairdot ${fmtNum(p.cl_crosshairdot)}`,
    `cl_crosshair_t ${fmtNum(p.cl_crosshair_t)}`,
    `cl_crosshair_recoil ${fmtNum(p.cl_crosshair_recoil)}`,
    `_c${n}b`,
  ].join('; ');

  // _cNb: outline, alpha, optional splitdist, then chain to _cNc
  const bParts = [
    `cl_crosshair_drawoutline ${fmtNum(p.cl_crosshair_drawoutline)}`,
    `cl_crosshair_outlinethickness ${fmtNum(p.cl_crosshair_outlinethickness)}`,
    `cl_crosshairusealpha ${fmtNum(p.cl_crosshairusealpha)}`,
    `cl_crosshairalpha ${fmtNum(p.cl_crosshairalpha)}`,
  ];
  if (p.cl_crosshair_dynamic_splitdist !== null && p.cl_crosshair_dynamic_splitdist !== undefined) {
    bParts.push(`cl_crosshair_dynamic_splitdist ${fmtNum(p.cl_crosshair_dynamic_splitdist)}`);
  }
  bParts.push(`_c${n}c`);
  const partB = bParts.join('; ');

  // _cNc: color + echo banner
  const submittedSuffix = preset.submittedBy ? ` (by ${preset.submittedBy})` : '';
  const partC = [
    `cl_crosshaircolor 5`,
    `cl_crosshaircolor_r ${fmtNum(p.cl_crosshaircolor_r)}`,
    `cl_crosshaircolor_g ${fmtNum(p.cl_crosshaircolor_g)}`,
    `cl_crosshaircolor_b ${fmtNum(p.cl_crosshaircolor_b)}`,
    `echo [CURSED #${n}] ${preset.name}${submittedSuffix}`,
  ].join('; ');

  return [
    `alias _c${n}  "${partA}"`,
    `alias _c${n}b "${partB}"`,
    `alias _c${n}c "${partC}"`,
  ];
}

function buildRotation(count) {
  if (count === 0) return [];
  const lines = [];
  for (let i = 1; i <= count; i++) {
    const next = i === count ? 1 : i + 1;
    lines.push(`alias _link${i}  "_c${i};  alias cursed_next _link${next}"`);
  }
  lines.push(`alias cursed_next _link1`);
  return lines;
}

function buildRestoreAliases(restore) {
  const p = restore.params;

  const a = [
    `cl_crosshairstyle ${fmtNum(p.cl_crosshairstyle)}`,
    `cl_crosshairsize ${fmtNum(p.cl_crosshairsize)}`,
    `cl_crosshairthickness ${fmtNum(p.cl_crosshairthickness)}`,
    `cl_crosshairgap ${fmtNum(p.cl_crosshairgap)}`,
    `cl_crosshairdot ${fmtNum(p.cl_crosshairdot)}`,
    `cl_crosshair_t ${fmtNum(p.cl_crosshair_t)}`,
    `_rb`,
  ].join('; ');

  const b = [
    `cl_crosshair_recoil ${fmtNum(p.cl_crosshair_recoil)}`,
    `cl_crosshairgap_useweaponvalue ${fmtNum(p.cl_crosshairgap_useweaponvalue)}`,
    `cl_fixedcrosshairgap ${fmtNum(p.cl_fixedcrosshairgap)}`,
    `cl_crosshair_drawoutline ${fmtNum(p.cl_crosshair_drawoutline)}`,
    `cl_crosshair_outlinethickness ${fmtNum(p.cl_crosshair_outlinethickness)}`,
    `_rc`,
  ].join('; ');

  const c = [
    `cl_crosshaircolor 5`,
    `cl_crosshaircolor_r ${fmtNum(p.cl_crosshaircolor_r)}`,
    `cl_crosshaircolor_g ${fmtNum(p.cl_crosshaircolor_g)}`,
    `cl_crosshaircolor_b ${fmtNum(p.cl_crosshaircolor_b)}`,
    `cl_crosshairusealpha ${fmtNum(p.cl_crosshairusealpha)}`,
    `cl_crosshairalpha ${fmtNum(p.cl_crosshairalpha)}`,
    `_rd`,
  ].join('; ');

  const d = [
    `cl_crosshair_dynamic_maxdist_splitratio ${fmtNum(p.cl_crosshair_dynamic_maxdist_splitratio)}`,
    `cl_crosshair_dynamic_splitalpha_innermod ${fmtNum(p.cl_crosshair_dynamic_splitalpha_innermod)}`,
    `cl_crosshair_dynamic_splitalpha_outermod ${fmtNum(p.cl_crosshair_dynamic_splitalpha_outermod)}`,
    `cl_crosshair_dynamic_splitdist ${fmtNum(p.cl_crosshair_dynamic_splitdist)}`,
    `echo [NORMAL] Gruenes Crosshair zurueck`,
  ].join('; ');

  return [
    `alias cursed_restore "${a}"`,
    `alias _rb "${b}"`,
    `alias _rc "${c}"`,
    `alias _rd "${d}"`,
  ];
}

function buildKeySetup(keys) {
  const next = keys.next || 'f7';
  const restore = keys.restore || 'f8';
  return `alias _setup_keys "unbind ${next}; bind ${next} cursed_next; unbind ${restore}; bind ${restore} cursed_restore"`;
}

function buildCfg(state) {
  const presets = Array.isArray(state.presets) ? state.presets : [];
  const restore = state.restore;
  const keys = state.keys || { next: 'f7', restore: 'f8' };
  const n = presets.length;

  const lines = [];
  lines.push('// =======================================================');
  lines.push('//            CURSED CROSSHAIR CONFIG');
  lines.push(`//            ${n} PRESETS`);
  lines.push('// =======================================================');
  lines.push('');
  lines.push('echo " "');
  lines.push('echo "====================================="');
  lines.push(`echo "  CURSED CROSSHAIR LAEDT (${n} Presets)"`);
  lines.push('echo "====================================="');
  lines.push('');
  lines.push('// --- KEY CONFIG ---');
  lines.push(buildKeySetup(keys));
  lines.push('');
  lines.push('// --- PRESETS ---');
  presets.forEach((preset, idx) => {
    const aliases = buildPresetAliases(idx, preset);
    lines.push(...aliases);
  });
  lines.push('');
  lines.push('// --- ROTATION ---');
  lines.push(...buildRotation(n));
  lines.push('');
  lines.push('// --- RESTORE ---');
  lines.push(...buildRestoreAliases(restore));
  lines.push('');
  lines.push('// --- APPLY KEY BINDS ---');
  lines.push('_setup_keys');
  lines.push('');
  lines.push('// --- DEFAULT ON LOAD ---');
  lines.push('cursed_restore');
  lines.push('');
  lines.push('echo " "');
  lines.push('echo "====================================="');
  lines.push(`echo "  ${keys.next || 'f7'} = naechstes cursed (${n} total)"`);
  lines.push(`echo "  ${keys.restore || 'f8'} = gruenes crosshair zurueck"`);
  lines.push('echo "====================================="');
  lines.push('echo " "');
  lines.push('');

  return lines.join('\n');
}

module.exports = {
  buildCfg,
  // exposed for unit-test-like introspection
  _internal: {
    fmtNum,
    buildPresetAliases,
    buildRestoreAliases,
    buildRotation,
    buildKeySetup,
  },
};
