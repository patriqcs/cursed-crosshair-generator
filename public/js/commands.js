// Console-command parser + formatter for crosshair params.
// Accepts pasted blocks like:
//   cl_crosshairstyle 4
//   cl_crosshair_length 8; cl_crosshair_thickness 2; cl_crosshaircolor_r 255
// or even alias-chain output from the .cfg exporter.
//
// Zusaetzlich werden die ALTEN Cvar-Namen (vor dem CS2-Update 2026-09-22)
// akzeptiert. parseCommands liefert dann ein Legacy-Objekt; der Aufrufer
// prueft isLegacyParams() und rechnet mit migrateLegacyParams() um.

import { CVAR_KEYS, LEGACY_KEYS } from './cvars.js';

const KNOWN_COMMANDS = new Set(CVAR_KEYS);

// Alte Cvar-Namen, die nur noch fuer den Import erkannt werden. Die
// gemeinsamen Namen (style, dot, t, recoil, drawoutline, color_r/g/b,
// dynamic_*) sind bereits in CVAR_KEYS enthalten.
const LEGACY_COMMANDS = new Set(LEGACY_KEYS);

// Strip line comments (// ...) but preserve everything else
function stripComments(line) {
  return line.replace(/\/\/.*$/, '').replace(/^\s*#.*/, '');
}

// Strip outer alias quotes: alias _c1 "cl_crosshairstyle 4; ..." -> cl_crosshairstyle 4; ...
// If the line is an alias declaration we drop the alias name and unwrap.
function stripAliasWrapper(line) {
  // alias <name> "<body>"  OR  alias <name> <body>
  const m = line.match(/^alias\s+\S+\s+"(.*)"\s*$/i)
        || line.match(/^alias\s+\S+\s+(.*)$/i);
  if (m) return m[1];
  return line;
}

// Wert-Token -> Zahl. CS2 schreibt Bool-Cvars als true/false.
function parseValue(str) {
  const s = String(str).trim().toLowerCase();
  if (s === 'true') return 1;
  if (s === 'false') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Parse a pasted blob of console commands into a params object.
// Returns null if no known crosshair commands were found. Enthaelt das
// Ergebnis alte Cvar-Namen, erkennt der Aufrufer das via isLegacyParams().
export function parseCommands(text) {
  if (typeof text !== 'string') return null;
  const params = {};
  let foundAny = false;

  // First handle line-level structure: split on newlines, then each "line"
  // can still contain semicolon-separated statements.
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    let line = stripComments(rawLine).trim();
    if (!line) continue;
    line = stripAliasWrapper(line).trim();
    if (!line) continue;

    const statements = line.split(';');
    for (const rawStmt of statements) {
      const stmt = rawStmt.trim();
      if (!stmt) continue;
      // Skip alias chain references like "_c1b" or "cursed_restore" (no value)
      // We only accept tokens of form "<name> <value>" (value numeric, true/false,
      // optionally quoted).
      const match = stmt.match(/^([a-z_][a-z0-9_]*)\s+(?:"([^"]*)"|(-?\d+(?:\.\d+)?|true|false))\s*$/i);
      if (!match) continue;
      const cmd = match[1].toLowerCase();
      if (!KNOWN_COMMANDS.has(cmd) && !LEGACY_COMMANDS.has(cmd)) continue;
      const value = parseValue(match[2] !== undefined ? match[2] : match[3]);
      if (value === null) continue;
      params[cmd] = value;
      foundAny = true;
    }
  }

  return foundAny ? params : null;
}

// Integer ohne Dezimalen, Floats mit max. 2 Dezimalen (getrimmt).
function fmt(n) {
  if (Number.isInteger(n)) return String(n);
  return Number(n).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

// Reihenfolge = CVAR_KEYS; cl_crosshair_screen_height steht dort zuletzt und
// MUSS zuletzt bleiben — das Spiel ueberschreibt ihn bei jeder Aenderung von
// length/thickness/gap mit der aktuellen Aufloesung.
const ORDER = CVAR_KEYS;

// Build a single-line console-command string for pasting into CS2 console.
// Order matches the cfg exporter so it visually reads top-down.
export function formatCommands(params, opts = {}) {
  const oneLine = opts.singleLine !== false;
  const include = (k) => params[k] !== undefined && params[k] !== null;
  const parts = [];
  for (const k of ORDER) {
    if (include(k)) parts.push(`${k} ${fmt(params[k])}`);
  }
  return oneLine ? parts.join('; ') : parts.join('\n');
}

export { KNOWN_COMMANDS };
