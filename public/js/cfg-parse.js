// Parser for the cursed_crosshair.cfg format produced by lib/cfg-export.js.
// Reverses the 3-part alias chain (_cN / _cNb / _cNc) back into preset
// objects, plus the 4-part restore chain (cursed_restore / _rb / _rc / _rd)
// and the key bindings.

import { parseCommands } from './commands.js';

// Strip outer quotes around an alias body
function stripQuotes(s) {
  const m = /^"(.*)"\s*$/s.exec(s);
  return m ? m[1] : s;
}

function findAliases(text) {
  // Match: alias <name> "<body>"  OR  alias <name> <body-without-spaces>
  // Use multiline + dotall-equivalent.
  const out = new Map();
  const re = /^\s*alias\s+(\S+)\s+(.+)$/gmi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    const body = stripQuotes(m[2].trim());
    out.set(name.toLowerCase(), body);
  }
  return out;
}

// Parse a `_cN` group of three aliases. Returns null if the chain is broken.
function parsePresetGroup(idx, aliases) {
  const a = aliases.get(`_c${idx}`);
  const b = aliases.get(`_c${idx}b`);
  const c = aliases.get(`_c${idx}c`);
  if (!a || !b || !c) return null;
  // Combine all three; parseCommands ignores alias-chain refs that aren't
  // <cmd> <value> pairs.
  const combined = `${a}; ${b}; ${c}`;
  const params = parseCommands(combined) || {};

  // Extract preset name + optional submitter from `_cNc` echo line:
  // echo [CURSED #N] <name>  OR  echo [CURSED #N] <name> (by <submitter>)
  let name = `Preset ${idx}`;
  let submittedBy = null;
  const echoMatch = c.match(/echo\s+\[CURSED\s+#\d+\]\s*(.+?)\s*$/i);
  if (echoMatch) {
    let raw = echoMatch[1].trim();
    const byMatch = raw.match(/^(.+?)\s+\(by\s+([^)]+)\)\s*$/i);
    if (byMatch) {
      name = byMatch[1].trim();
      submittedBy = byMatch[2].trim();
    } else {
      name = raw;
    }
  }

  // Normalise: ensure expected default fields exist
  const out = {
    name,
    params: {
      cl_crosshairstyle:      params.cl_crosshairstyle ?? 4,
      cl_crosshairsize:       params.cl_crosshairsize ?? 5,
      cl_crosshairthickness:  params.cl_crosshairthickness ?? 0.5,
      cl_crosshairgap:        params.cl_crosshairgap ?? 0,
      cl_crosshairdot:        params.cl_crosshairdot ?? 0,
      cl_crosshair_t:         params.cl_crosshair_t ?? 0,
      cl_crosshair_recoil:    params.cl_crosshair_recoil ?? 0,
      cl_crosshair_drawoutline: params.cl_crosshair_drawoutline ?? 0,
      cl_crosshair_outlinethickness: params.cl_crosshair_outlinethickness ?? 0,
      cl_crosshairusealpha:   params.cl_crosshairusealpha ?? 0,
      cl_crosshairalpha:      params.cl_crosshairalpha ?? 255,
      cl_crosshaircolor_r:    params.cl_crosshaircolor_r ?? 0,
      cl_crosshaircolor_g:    params.cl_crosshaircolor_g ?? 255,
      cl_crosshaircolor_b:    params.cl_crosshaircolor_b ?? 0,
      cl_crosshair_dynamic_splitdist: params.cl_crosshair_dynamic_splitdist ?? null,
    },
  };
  if (submittedBy) out.submittedBy = submittedBy;
  return out;
}

function parseRestoreGroup(aliases) {
  const a = aliases.get('cursed_restore');
  const b = aliases.get('_rb');
  const c = aliases.get('_rc');
  const d = aliases.get('_rd');
  if (!a || !b || !c || !d) return null;
  const combined = `${a}; ${b}; ${c}; ${d}`;
  const params = parseCommands(combined) || {};
  return {
    params: {
      cl_crosshairstyle:      params.cl_crosshairstyle ?? 4,
      cl_crosshairsize:       params.cl_crosshairsize ?? 0.8,
      cl_crosshairthickness:  params.cl_crosshairthickness ?? 0.9,
      cl_crosshairgap:        params.cl_crosshairgap ?? -4,
      cl_crosshairdot:        params.cl_crosshairdot ?? 0,
      cl_crosshair_t:         params.cl_crosshair_t ?? 0,
      cl_crosshair_recoil:    params.cl_crosshair_recoil ?? 0,
      cl_crosshairgap_useweaponvalue: params.cl_crosshairgap_useweaponvalue ?? 0,
      cl_fixedcrosshairgap:   params.cl_fixedcrosshairgap ?? 3,
      cl_crosshair_drawoutline: params.cl_crosshair_drawoutline ?? 1,
      cl_crosshair_outlinethickness: params.cl_crosshair_outlinethickness ?? 0,
      cl_crosshairusealpha:   params.cl_crosshairusealpha ?? 0,
      cl_crosshairalpha:      params.cl_crosshairalpha ?? 255,
      cl_crosshaircolor_r:    params.cl_crosshaircolor_r ?? 0,
      cl_crosshaircolor_g:    params.cl_crosshaircolor_g ?? 255,
      cl_crosshaircolor_b:    params.cl_crosshaircolor_b ?? 91,
      cl_crosshair_dynamic_maxdist_splitratio: params.cl_crosshair_dynamic_maxdist_splitratio ?? 1,
      cl_crosshair_dynamic_splitalpha_innermod: params.cl_crosshair_dynamic_splitalpha_innermod ?? 0,
      cl_crosshair_dynamic_splitalpha_outermod: params.cl_crosshair_dynamic_splitalpha_outermod ?? 1,
      cl_crosshair_dynamic_splitdist: params.cl_crosshair_dynamic_splitdist ?? 3,
    },
  };
}

// Parse `_setup_keys "unbind <next>; bind <next> cursed_next; unbind <restore>; bind <restore> cursed_restore"`
function parseKeys(aliases) {
  const body = aliases.get('_setup_keys');
  if (!body) return null;
  const next = (body.match(/bind\s+(\S+)\s+cursed_next/i) || [])[1];
  const restore = (body.match(/bind\s+(\S+)\s+cursed_restore/i) || [])[1];
  if (!next || !restore) return null;
  return { next: next.toLowerCase(), restore: restore.toLowerCase() };
}

// Parse the full cursed_crosshair.cfg text. Returns { presets, restore?, keys? }
// or null if no _cN groups were found at all.
export function parseCfg(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const aliases = findAliases(text);

  // Find all _cN aliases (without the b/c suffix) to determine N.
  const presetIndexes = [];
  for (const name of aliases.keys()) {
    const m = /^_c(\d+)$/.exec(name);
    if (m) presetIndexes.push(Number(m[1]));
  }
  presetIndexes.sort((a, b) => a - b);

  const presets = [];
  for (const idx of presetIndexes) {
    const p = parsePresetGroup(idx, aliases);
    if (p) presets.push(p);
  }

  if (presets.length === 0) return null;

  const out = { presets };
  const restore = parseRestoreGroup(aliases);
  if (restore) out.restore = restore;
  const keys = parseKeys(aliases);
  if (keys) out.keys = keys;
  return out;
}
