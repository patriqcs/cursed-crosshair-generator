'use strict';

// Export fuer das CS2 Crosshair-System seit 2026-09-22 (Pixel-Einheiten):
// alle 24 Cvars aus public/js/cvars.js werden IMMER geschrieben (seit dem Update vom
// 2026-09-30 inkl. Outline-Farbe cl_crosshairoutline_r/g/b/a und der Scope-Dot-Cvars
// cl_ironsight_usecrosshaircolor / cl_ironsight_dot_scale).
// cl_crosshair_screen_height ist ein Hidden-Cvar, den das Spiel bei jeder
// Aenderung von length/thickness/gap selbst ueberschreibt — deshalb steht er in
// jeder Alias-Kette als LETZTER Cvar. Der Client-Parser (cfg-parse.js) ist genau
// auf dieses Alias-Layout gebaut: Reihenfolge und Aufteilung nicht aendern.

// Strip characters that would break a quoted alias body in Source/CS2 cfg syntax:
// `"` ends the alias body and `;` starts a new command. Zusätzlich auf 40 Zeichen
// kürzen, damit überlange Namen die CS2-Konsolenzeile (~1023 Byte) nicht sprengen.
function sanitizeForCfgEcho(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/["';\n\r]/g, '').slice(0, 40);
}

// Defense-in-Depth: Bind-Keys gehen roh in `bind ${key} ...`; auch wenn der
// State-Validator bereits ^[a-z0-9_]{1,32}$ erzwingt, hier nochmal whitelisten,
// damit der Export auch bei künftig anderen Schreibpfaden injection-sicher bleibt.
function safeKey(key, fallback) {
  return typeof key === 'string' && /^[a-z0-9_]{1,32}$/.test(key) ? key : fallback;
}

// Zahlenformat fuer die cfg: Integer ohne Dezimalen, Floats mit max. 2 Dezimalen,
// trailing zeros getrimmt (0.5 -> "0.5", 0.30 -> "0.3", 1 -> "1").
function fmtNum(n) {
  if (n === null || n === undefined) return '';
  if (Number.isInteger(n)) return String(n);
  const fixed = Number(n).toFixed(2);
  return fixed.replace(/0+$/, '').replace(/\.$/, '');
}

// Die drei Teilketten eines Crosshairs. `chain` = Name des naechsten Alias,
// `tail` = letzter Befehl der dritten Kette (echo-Zeile).
function buildChainParts(p, chainB, chainC, tail) {
  const partA = [
    `cl_crosshairstyle ${fmtNum(p.cl_crosshairstyle)}`,
    `cl_crosshair_length ${fmtNum(p.cl_crosshair_length)}`,
    `cl_crosshair_thickness ${fmtNum(p.cl_crosshair_thickness)}`,
    `cl_crosshair_gap ${fmtNum(p.cl_crosshair_gap)}`,
    `cl_crosshairdot ${fmtNum(p.cl_crosshairdot)}`,
    `cl_crosshair_t ${fmtNum(p.cl_crosshair_t)}`,
    `cl_crosshair_recoil ${fmtNum(p.cl_crosshair_recoil)}`,
    // Scope-Dot-Cvars stehen in Teil A, damit keine der drei Zeilen zu lang wird.
    `cl_ironsight_usecrosshaircolor ${fmtNum(p.cl_ironsight_usecrosshaircolor)}`,
    `cl_ironsight_dot_scale ${fmtNum(p.cl_ironsight_dot_scale)}`,
    chainB,
  ].join('; ');

  const partB = [
    `cl_crosshair_drawoutline ${fmtNum(p.cl_crosshair_drawoutline)}`,
    `cl_crosshaircolor_r ${fmtNum(p.cl_crosshaircolor_r)}`,
    `cl_crosshaircolor_g ${fmtNum(p.cl_crosshaircolor_g)}`,
    `cl_crosshaircolor_b ${fmtNum(p.cl_crosshaircolor_b)}`,
    `cl_crosshaircolor_a ${fmtNum(p.cl_crosshaircolor_a)}`,
    `cl_crosshairoutline_r ${fmtNum(p.cl_crosshairoutline_r)}`,
    `cl_crosshairoutline_g ${fmtNum(p.cl_crosshairoutline_g)}`,
    `cl_crosshairoutline_b ${fmtNum(p.cl_crosshairoutline_b)}`,
    `cl_crosshairoutline_a ${fmtNum(p.cl_crosshairoutline_a)}`,
    `cl_crosshair_dynamic_spread_limit ${fmtNum(p.cl_crosshair_dynamic_spread_limit)}`,
    chainC,
  ].join('; ');

  // screen_height MUSS der letzte Cvar sein (siehe Kopfkommentar).
  const partC = [
    `cl_crosshair_dynamic_splitdist ${fmtNum(p.cl_crosshair_dynamic_splitdist)}`,
    `cl_crosshair_dynamic_splitalpha_innermod ${fmtNum(p.cl_crosshair_dynamic_splitalpha_innermod)}`,
    `cl_crosshair_dynamic_splitalpha_outermod ${fmtNum(p.cl_crosshair_dynamic_splitalpha_outermod)}`,
    `cl_crosshair_dynamic_maxdist_splitratio ${fmtNum(p.cl_crosshair_dynamic_maxdist_splitratio)}`,
    `cl_crosshair_screen_height ${fmtNum(p.cl_crosshair_screen_height)}`,
    tail,
  ].join('; ');

  return { partA, partB, partC };
}

function buildPresetAliases(idx, preset) {
  const n = idx + 1;
  const safeSubmittedBy = sanitizeForCfgEcho(preset.submittedBy);
  const submittedSuffix = safeSubmittedBy ? ` (by ${safeSubmittedBy})` : '';
  const safeName = sanitizeForCfgEcho(preset.name);
  const echo = `echo [CURSED #${n}] ${safeName}${submittedSuffix}`;

  const { partA, partB, partC } = buildChainParts(preset.params, `_c${n}b`, `_c${n}c`, echo);
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
  const { partA, partB, partC } = buildChainParts(
    restore.params, '_rb', '_rc', 'echo [NORMAL] Gruenes Crosshair zurueck',
  );
  return [
    `alias cursed_restore "${partA}"`,
    `alias _rb "${partB}"`,
    `alias _rc "${partC}"`,
  ];
}

function buildKeySetup(keys) {
  const next = safeKey(keys.next, 'f7');
  const restore = safeKey(keys.restore, 'f8');
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
  lines.push('//            CS2 Crosshair-System seit 2026-09-22 (Pixel-Einheiten), Stand 2026-09-30');
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
  lines.push(`echo "  ${safeKey(keys.next, 'f7')} = naechstes cursed (${n} total)"`);
  lines.push(`echo "  ${safeKey(keys.restore, 'f8')} = gruenes crosshair zurueck"`);
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
