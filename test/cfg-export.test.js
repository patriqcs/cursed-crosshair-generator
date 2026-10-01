'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCfg, _internal } = require('../lib/cfg-export');
const { CVAR_KEYS } = require('../lib/cvars');
const { GREEN_RESTORE_PARAMS } = require('../lib/defaults');

// Param-Satz im neuen Schema (CS2 seit 2026-09-22).
const VALID_PARAMS = Object.freeze({
  cl_crosshairstyle: 4,
  cl_crosshair_length: 40,
  cl_crosshair_thickness: 6,
  cl_crosshair_gap: 2,
  cl_crosshairdot: 1,
  cl_crosshair_t: 0,
  cl_crosshair_recoil: 1,
  cl_crosshair_drawoutline: 1,
  cl_crosshaircolor_r: 255,
  cl_crosshaircolor_g: 0,
  cl_crosshaircolor_b: 200,
  cl_crosshaircolor_a: 220,
  cl_crosshairoutline_r: 10,
  cl_crosshairoutline_g: 20,
  cl_crosshairoutline_b: 30,
  cl_crosshairoutline_a: 128,
  cl_crosshair_dynamic_spread_limit: 255,
  cl_crosshair_dynamic_splitdist: 3,
  cl_crosshair_dynamic_splitalpha_innermod: 0.35,
  cl_crosshair_dynamic_splitalpha_outermod: 1,
  cl_crosshair_dynamic_maxdist_splitratio: 0.5,
  cl_ironsight_usecrosshaircolor: 1,
  cl_ironsight_dot_scale: 1.25,
  cl_crosshair_screen_height: 1080,
});

function makeState({ submittedBy } = {}) {
  return {
    presets: [
      {
        id: 'a',
        name: 'Test',
        ...(submittedBy !== undefined ? { submittedBy } : {}),
        params: { ...VALID_PARAMS },
      },
    ],
    restore: { params: { ...GREEN_RESTORE_PARAMS } },
    keys: { next: 'f7', restore: 'f8' },
  };
}

// Only alias lines whose body is wrapped in double quotes (quoted-body form).
function quotedAliasLines(cfg) {
  return cfg.split('\n').filter((l) => /^alias \S+\s+"/.test(l));
}

function aliasBody(cfg, name) {
  const re = new RegExp(`^alias ${name}\\s+"(.*)"$`);
  const line = cfg.split('\n').find((l) => re.test(l));
  assert.ok(line, `expected alias ${name}`);
  return line.match(re)[1];
}

// --- Alias-Layout (verbindlich, Client-Parser haengt daran) ---------------------

test('preset chain _cN/_cNb/_cNc has the fixed cvar order and screen_height last', () => {
  const cfg = buildCfg(makeState({ submittedBy: 'pat' }));
  assert.equal(
    aliasBody(cfg, '_c1'),
    'cl_crosshairstyle 4; cl_crosshair_length 40; cl_crosshair_thickness 6; cl_crosshair_gap 2; '
    + 'cl_crosshairdot 1; cl_crosshair_t 0; cl_crosshair_recoil 1; '
    + 'cl_ironsight_usecrosshaircolor 1; cl_ironsight_dot_scale 1.25; _c1b',
  );
  assert.equal(
    aliasBody(cfg, '_c1b'),
    'cl_crosshair_drawoutline 1; cl_crosshaircolor_r 255; cl_crosshaircolor_g 0; cl_crosshaircolor_b 200; '
    + 'cl_crosshaircolor_a 220; cl_crosshairoutline_r 10; cl_crosshairoutline_g 20; cl_crosshairoutline_b 30; '
    + 'cl_crosshairoutline_a 128; cl_crosshair_dynamic_spread_limit 255; _c1c',
  );
  assert.equal(
    aliasBody(cfg, '_c1c'),
    'cl_crosshair_dynamic_splitdist 3; cl_crosshair_dynamic_splitalpha_innermod 0.35; '
    + 'cl_crosshair_dynamic_splitalpha_outermod 1; cl_crosshair_dynamic_maxdist_splitratio 0.5; '
    + 'cl_crosshair_screen_height 1080; echo [CURSED #1] Test (by pat)',
  );
});

test('restore chain cursed_restore/_rb/_rc mirrors the preset layout, no _rd', () => {
  const cfg = buildCfg(makeState());
  assert.equal(
    aliasBody(cfg, 'cursed_restore'),
    'cl_crosshairstyle 4; cl_crosshair_length 2; cl_crosshair_thickness 2; cl_crosshair_gap 1; '
    + 'cl_crosshairdot 0; cl_crosshair_t 0; cl_crosshair_recoil 0; '
    + 'cl_ironsight_usecrosshaircolor 0; cl_ironsight_dot_scale 1; _rb',
  );
  assert.equal(
    aliasBody(cfg, '_rb'),
    'cl_crosshair_drawoutline 0; cl_crosshaircolor_r 0; cl_crosshaircolor_g 255; cl_crosshaircolor_b 91; '
    + 'cl_crosshaircolor_a 255; cl_crosshairoutline_r 0; cl_crosshairoutline_g 0; cl_crosshairoutline_b 0; '
    + 'cl_crosshairoutline_a 255; cl_crosshair_dynamic_spread_limit 255; _rc',
  );
  assert.equal(
    aliasBody(cfg, '_rc'),
    'cl_crosshair_dynamic_splitdist 3; cl_crosshair_dynamic_splitalpha_innermod 0; '
    + 'cl_crosshair_dynamic_splitalpha_outermod 1; cl_crosshair_dynamic_maxdist_splitratio 1; '
    + 'cl_crosshair_screen_height 960; echo [NORMAL] Gruenes Crosshair zurueck',
  );
  assert.equal(cfg.includes('_rd'), false);
});

test('every chain writes all 24 cvars exactly once, none of the legacy cvars', () => {
  assert.equal(CVAR_KEYS.length, 24);
  const cfg = buildCfg(makeState());
  for (const prefix of [['_c1', '_c1b', '_c1c'], ['cursed_restore', '_rb', '_rc']]) {
    const body = prefix.map((n) => aliasBody(cfg, n)).join('; ');
    for (const k of CVAR_KEYS) {
      const hits = body.split('; ').filter((cmd) => cmd.startsWith(`${k} `)).length;
      assert.equal(hits, 1, `${k} written ${hits}x in ${prefix[0]}`);
    }
  }
  for (const legacy of ['cl_crosshairsize', 'cl_crosshairgap ', 'cl_crosshairthickness',
    'cl_crosshair_outlinethickness', 'cl_crosshairusealpha', 'cl_crosshairalpha', 'cl_crosshaircolor 5',
    'cl_fixedcrosshairgap', 'cl_crosshairgap_useweaponvalue']) {
    assert.equal(cfg.includes(legacy), false, `legacy cvar leaked: ${legacy}`);
  }
});

test('echo line omits (by ...) when there is no submittedBy', () => {
  const cfg = buildCfg(makeState());
  assert.ok(aliasBody(cfg, '_c1c').endsWith('echo [CURSED #1] Test'));
});

test('header mentions the 2026-09-22 crosshair system, rotation and key setup unchanged', () => {
  const state = makeState();
  state.presets.push({ id: 'b', name: 'Zwei', params: { ...VALID_PARAMS } });
  const cfg = buildCfg(state);
  assert.ok(cfg.includes('CS2 Crosshair-System seit 2026-09-22 (Pixel-Einheiten)'));
  assert.ok(cfg.includes('alias _link1  "_c1;  alias cursed_next _link2"'));
  assert.ok(cfg.includes('alias _link2  "_c2;  alias cursed_next _link1"'));
  assert.ok(cfg.includes('alias cursed_next _link1'));
  assert.ok(cfg.includes('alias _setup_keys "unbind f7; bind f7 cursed_next; unbind f8; bind f8 cursed_restore"'));
  assert.ok(cfg.includes('\ncursed_restore\n'));
});

test('fmtNum: integers without decimals, floats max 2 decimals, trailing zeros trimmed', () => {
  const { fmtNum } = _internal;
  assert.equal(fmtNum(1), '1');
  assert.equal(fmtNum(255), '255');
  assert.equal(fmtNum(0.5), '0.5');
  assert.equal(fmtNum(0.35), '0.35');
  assert.equal(fmtNum(0.3), '0.3');
  assert.equal(fmtNum(0.456), '0.46');
  assert.equal(fmtNum(0.999), '1');
  assert.equal(fmtNum(null), '');
});

// --- Injection-Tests (unveraendert relevant) ------------------------------------

test('buildCfg keeps alias quoting balanced for benign submittedBy', () => {
  const cfg = buildCfg(makeState({ submittedBy: 'patrick' }));
  for (const line of quotedAliasLines(cfg)) {
    const quotes = (line.match(/"/g) || []).length;
    assert.equal(quotes, 2, `unbalanced alias line: ${line}`);
  }
});

test('buildCfg sanitizes hostile submittedBy so aliases remain well-formed', () => {
  const hostile = 'evil"; bind f9 quit;';
  const cfg = buildCfg(makeState({ submittedBy: hostile }));
  // The two cfg injection vectors inside a quoted alias body are `"` and `;`.
  // After sanitisation, the echo body for our preset must contain neither.
  const body = aliasBody(cfg, '_c1c');
  const echoSegment = body.split(';').pop();
  assert.equal(echoSegment.includes('"'), false, `echo segment contains quote: ${echoSegment}`);
  // The submittedBy portion lives after "(by " — it must not have ; that would
  // close the echo and start a new command.
  const submittedPart = echoSegment.split('(by ')[1] || '';
  assert.equal(submittedPart.includes(';'), false, `submittedBy leaked semicolon: ${submittedPart}`);
});

test('buildCfg sanitizes hostile preset NAME in the echo line', () => {
  const state = makeState();
  state.presets[0].name = 'evil"; bind f9 quit;';
  const cfg = buildCfg(state);
  const echoLine = cfg.split('\n').find((l) => /^alias _c1c\s+"/.test(l));
  assert.ok(echoLine, 'expected _c1c alias line');
  const quotes = (echoLine.match(/"/g) || []).length;
  assert.equal(quotes, 2, `unbalanced alias line from hostile name: ${echoLine}`);
});

test('buildCfg sanitizes hostile bind keys to safe fallbacks', () => {
  const state = makeState();
  state.keys = { next: 'f7; quit', restore: 'f8" bind x kill' };
  const cfg = buildCfg(state);
  const setupLine = cfg.split('\n').find((l) => /^alias _setup_keys\s+"/.test(l));
  assert.ok(setupLine, 'expected _setup_keys alias line');
  const body = setupLine.match(/^alias _setup_keys\s+"(.*)"$/)[1];
  assert.equal(body.includes('quit'), false, `hostile next key leaked: ${body}`);
  assert.equal(body.includes('kill'), false, `hostile restore key leaked: ${body}`);
  assert.ok(body.includes('bind f7 cursed_next'));
  assert.ok(body.includes('bind f8 cursed_restore'));
});

// --- Laengen und Rueckweg ueber den Client-Parser --------------------------------

const WORST_PARAMS = Object.freeze({
  ...VALID_PARAMS,
  cl_crosshair_length: 255, cl_crosshair_thickness: 32, cl_crosshair_gap: -3840,
  cl_crosshaircolor_r: 255, cl_crosshaircolor_g: 255, cl_crosshaircolor_b: 255, cl_crosshaircolor_a: 255,
  cl_crosshairoutline_r: 255, cl_crosshairoutline_g: 255, cl_crosshairoutline_b: 255, cl_crosshairoutline_a: 255,
  cl_crosshair_dynamic_splitdist: 127,
  cl_crosshair_dynamic_splitalpha_innermod: 0.37, cl_crosshair_dynamic_splitalpha_outermod: 0.83,
  cl_crosshair_dynamic_maxdist_splitratio: 0.29, cl_ironsight_dot_scale: 1.25,
  cl_crosshair_screen_height: 65535,
});

test('alias lines stay well below the 510-char console command limit with worst-case values', () => {
  const state = makeState();
  state.presets = Array.from({ length: 120 }, (_, i) => ({
    id: String(i), name: 'N'.repeat(60), submittedBy: 'S'.repeat(40), params: { ...WORST_PARAMS },
  }));
  const cfg = buildCfg(state);
  const longest = Math.max(...quotedAliasLines(cfg).map((l) => l.length));
  assert.ok(longest < 420, `longest alias line: ${longest}`);
});

test('cfg roundtrips through the client parser (all 24 cvars, negative gap, outline color, style 9)', async () => {
  const { parseCfg } = await import('../public/js/cfg-parse.js');
  const state = makeState({ submittedBy: 'pat' });
  state.presets[0].params = { ...WORST_PARAMS, cl_crosshairstyle: 9 };
  const parsed = parseCfg(buildCfg(state));
  assert.equal(parsed.presets.length, 1);
  assert.deepEqual(parsed.presets[0].params, state.presets[0].params);
  assert.equal(parsed.presets[0].submittedBy, 'pat');
  assert.deepEqual(parsed.restore.params, GREEN_RESTORE_PARAMS);
});

test('client parser: cfg from before 2026-09-30 (no outline cvars) gets black outline with crosshair alpha', async () => {
  const { parseCfg } = await import('../public/js/cfg-parse.js');
  const old = [
    'alias _c1  "cl_crosshairstyle 4; cl_crosshair_length 40; cl_crosshair_thickness 6; cl_crosshair_gap 2; cl_crosshairdot 1; cl_crosshair_t 0; cl_crosshair_recoil 1; _c1b"',
    'alias _c1b "cl_crosshair_drawoutline 1; cl_crosshaircolor_r 255; cl_crosshaircolor_g 0; cl_crosshaircolor_b 200; cl_crosshaircolor_a 120; cl_crosshair_dynamic_spread_limit 255; _c1c"',
    'alias _c1c "cl_crosshair_dynamic_splitdist 3; cl_crosshair_dynamic_splitalpha_innermod 0.35; cl_crosshair_dynamic_splitalpha_outermod 1; cl_crosshair_dynamic_maxdist_splitratio 0.5; cl_crosshair_screen_height 1080; echo [CURSED #1] Alt"',
  ].join('\n');
  const p = parseCfg(old).presets[0].params;
  assert.equal(p.cl_crosshairoutline_a, 120);
  assert.deepEqual([p.cl_crosshairoutline_r, p.cl_crosshairoutline_g, p.cl_crosshairoutline_b], [0, 0, 0]);
  assert.equal(p.cl_ironsight_dot_scale, 1);
  assert.equal(p.cl_crosshair_dynamic_splitalpha_innermod, 0.35);
});
