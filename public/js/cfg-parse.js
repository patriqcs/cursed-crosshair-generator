// Parser for the cursed_crosshair.cfg format produced by lib/cfg-export.js.
// Reverses the 3-part alias chain (_cN / _cNb / _cNc) back into preset
// objects, plus the 3-part restore chain (cursed_restore / _rb / _rc)
// and the key bindings.
//
// Tolerant gegenueber alten Cfgs (vor dem CS2-Update 2026-09-22): dort gab es
// noch eine vierte Restore-Alias (_rd) und die alten Cvars (cl_crosshairsize,
// cl_crosshairgap, ...). Solche Params werden via isLegacyParams() erkannt,
// mit migrateLegacyParams() auf das neue Pixel-System umgerechnet und das
// Ergebnis mit `migrated: true` markiert, damit der Admin die Werte prueft.

import { parseCommands } from './commands.js';
import { normalizeParams, isLegacyParams, fillMissingOutline } from './cvars.js';
import { migrateLegacyParams } from './migrate.js';

// Bezugshoehe fuer die Umrechnung alter Cfgs. Der alte Exporter kannte keine
// Aufloesung; 1080p ist die verbreitetste Annahme.
const LEGACY_SCREEN_HEIGHT = 1080;

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

// Geparste Rohwerte -> { params, migrated }. Alte Cvars werden migriert,
// fehlende Werte fuellt normalizeParams mit Defaults.
function toParams(raw) {
  const src = raw || {};
  if (isLegacyParams(src)) {
    return { params: migrateLegacyParams(src, { screenHeight: LEGACY_SCREEN_HEIGHT }), migrated: true };
  }
  // normalizeParams liefert null bei ungueltigen Werten (z.B. unbekannter
  // Style) — dann Defaults, statt den ganzen Import abzubrechen.
  // Cfgs von vor dem 2026-09-30 haben keine Outline-Farbe -> Schwarz mit Crosshair-Alpha.
  const params = normalizeParams(fillMissingOutline(src)) || normalizeParams({});
  return { params, migrated: false };
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
  const { params, migrated } = toParams(parseCommands(combined));

  // Extract preset name + optional submitter from `_cNc` echo line:
  // echo [CURSED #N] <name>  OR  echo [CURSED #N] <name> (by <submitter>)
  let name = `Preset ${idx}`;
  let submittedBy = null;
  const echoMatch = c.match(/echo\s+\[CURSED\s+#\d+\]\s*(.+?)\s*$/i);
  if (echoMatch) {
    const raw = echoMatch[1].trim();
    const byMatch = raw.match(/^(.+?)\s+\(by\s+([^)]+)\)\s*$/i);
    if (byMatch) {
      name = byMatch[1].trim();
      submittedBy = byMatch[2].trim();
    } else {
      name = raw;
    }
  }

  const out = { name, params };
  if (submittedBy) out.submittedBy = submittedBy;
  if (migrated) out.migrated = true;
  return out;
}

// Restore-Kette: cursed_restore / _rb / _rc (+ optional _rd aus alten Cfgs).
function parseRestoreGroup(aliases) {
  const a = aliases.get('cursed_restore');
  const b = aliases.get('_rb');
  const c = aliases.get('_rc');
  if (!a || !b || !c) return null;
  const d = aliases.get('_rd');
  const combined = [a, b, c, d].filter(Boolean).join('; ');
  const { params, migrated } = toParams(parseCommands(combined));
  const out = { params };
  if (migrated) out.migrated = true;
  return out;
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
