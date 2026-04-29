// Console-command parser + formatter for crosshair params.
// Accepts pasted blocks like:
//   cl_crosshairstyle 4
//   cl_crosshairsize 5; cl_crosshairthickness 1; cl_crosshaircolor_r 255
// or even alias-chain output from the .cfg exporter.

const KNOWN_COMMANDS = new Set([
  'cl_crosshairstyle',
  'cl_crosshairsize',
  'cl_crosshairthickness',
  'cl_crosshairgap',
  'cl_crosshairdot',
  'cl_crosshair_t',
  'cl_crosshair_recoil',
  'cl_crosshair_drawoutline',
  'cl_crosshair_outlinethickness',
  'cl_crosshairusealpha',
  'cl_crosshairalpha',
  'cl_crosshaircolor',
  'cl_crosshaircolor_r',
  'cl_crosshaircolor_g',
  'cl_crosshaircolor_b',
  'cl_crosshair_dynamic_splitdist',
  'cl_crosshair_dynamic_splitalpha_innermod',
  'cl_crosshair_dynamic_splitalpha_outermod',
  'cl_crosshair_dynamic_maxdist_splitratio',
  'cl_crosshairgap_useweaponvalue',
  'cl_fixedcrosshairgap',
]);

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

// Parse a pasted blob of console commands into a params object.
// Returns null if no known crosshair commands were found.
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
      // We only accept tokens of form "<name> <value>"
      const match = stmt.match(/^([a-z_][a-z0-9_]*)\s+(?:"([^"]*)"|(-?\d+(?:\.\d+)?))\s*$/i);
      if (!match) continue;
      const cmd = match[1].toLowerCase();
      if (!KNOWN_COMMANDS.has(cmd)) continue;
      const valueStr = match[2] !== undefined ? match[2] : match[3];
      const value = Number(valueStr);
      if (!Number.isFinite(value)) continue;
      params[cmd] = value;
      foundAny = true;
    }
  }

  return foundAny ? params : null;
}

function fmt(n) {
  if (Number.isInteger(n)) return String(n);
  return Number(n).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

// Build a single-line console-command string for pasting into CS2 console.
// Order roughly matches the cfg exporter so it visually reads top-down.
export function formatCommands(params, opts = {}) {
  const oneLine = opts.singleLine !== false;
  const include = (k) => params[k] !== undefined && params[k] !== null;
  const order = [
    'cl_crosshairstyle',
    'cl_crosshairsize',
    'cl_crosshairthickness',
    'cl_crosshairgap',
    'cl_crosshairdot',
    'cl_crosshair_t',
    'cl_crosshair_recoil',
    'cl_crosshair_drawoutline',
    'cl_crosshair_outlinethickness',
    'cl_crosshairusealpha',
    'cl_crosshairalpha',
    'cl_crosshaircolor',
    'cl_crosshaircolor_r',
    'cl_crosshaircolor_g',
    'cl_crosshaircolor_b',
    'cl_crosshair_dynamic_splitdist',
  ];
  const parts = [];
  for (const k of order) {
    if (include(k)) parts.push(`${k} ${fmt(params[k])}`);
  }
  return oneLine ? parts.join('; ') : parts.join('\n');
}

export { KNOWN_COMMANDS };
