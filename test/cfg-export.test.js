'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildCfg } = require('../lib/cfg-export');

const VALID_PARAMS = Object.freeze({
  cl_crosshairstyle: 4,
  cl_crosshairsize: 5,
  cl_crosshairthickness: 1,
  cl_crosshairgap: -2,
  cl_crosshairdot: 0,
  cl_crosshair_t: 0,
  cl_crosshair_recoil: 0,
  cl_crosshair_drawoutline: 1,
  cl_crosshair_outlinethickness: 1,
  cl_crosshairusealpha: 1,
  cl_crosshairalpha: 255,
  cl_crosshaircolor_r: 255,
  cl_crosshaircolor_g: 0,
  cl_crosshaircolor_b: 200,
  cl_crosshair_dynamic_splitdist: null,
});

const VALID_RESTORE = Object.freeze({
  ...VALID_PARAMS,
  cl_crosshairgap_useweaponvalue: 0,
  cl_fixedcrosshairgap: 3,
  cl_crosshair_dynamic_maxdist_splitratio: 1,
  cl_crosshair_dynamic_splitalpha_innermod: 0,
  cl_crosshair_dynamic_splitalpha_outermod: 1,
  cl_crosshair_dynamic_splitdist: 3,
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
    restore: { params: { ...VALID_RESTORE } },
    keys: { next: 'f7', restore: 'f8' },
  };
}

// Only alias lines whose body is wrapped in double quotes (quoted-body form).
function quotedAliasLines(cfg) {
  return cfg.split('\n').filter((l) => /^alias \S+\s+"/.test(l));
}

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
  const echoLine = cfg
    .split('\n')
    .find((l) => /^alias _c1c\s+"/.test(l));
  assert.ok(echoLine, 'expected to find _c1c alias line');
  const body = echoLine.match(/^alias _c1c\s+"(.*)"$/)[1];
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
