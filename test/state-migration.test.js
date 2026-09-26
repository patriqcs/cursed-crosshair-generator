'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// lib/storage.js liest DATA_DIR bei jedem Zugriff aus process.env -> vor dem
// require setzen und pro Test auf ein frisches temporaeres Verzeichnis zeigen.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-state-migration-'));
process.env.DATA_DIR = tmpRoot;

const state = require('../lib/state');
const { isLegacyParams, CVAR_KEYS } = require('../lib/cvars');
const { GREEN_RESTORE_PARAMS } = require('../lib/defaults');

const LEGACY_PRESET_PARAMS = {
  cl_crosshairstyle: 4,
  cl_crosshairsize: 150,
  cl_crosshairthickness: 30,
  cl_crosshairgap: -30,
  cl_crosshairdot: 0,
  cl_crosshair_t: 0,
  cl_crosshair_recoil: 0,
  cl_crosshair_drawoutline: 0,
  cl_crosshair_outlinethickness: 1,
  cl_crosshairusealpha: 1,
  cl_crosshairalpha: 255,
  cl_crosshaircolor_r: 50,
  cl_crosshaircolor_g: 255,
  cl_crosshaircolor_b: 50,
  cl_crosshair_dynamic_splitdist: null,
};

const LEGACY_RESTORE_PARAMS = {
  cl_crosshairstyle: 4,
  cl_crosshairsize: 0.8,
  cl_crosshairthickness: 0.9,
  cl_crosshairgap: -4.3,
  cl_crosshairdot: 0,
  cl_crosshair_t: 0,
  cl_crosshair_recoil: 0,
  cl_crosshair_drawoutline: 1,
  cl_crosshair_outlinethickness: 0,
  cl_crosshairusealpha: 0,
  cl_crosshairalpha: 255,
  cl_crosshaircolor_r: 0,
  cl_crosshaircolor_g: 255,
  cl_crosshaircolor_b: 91,
  cl_crosshairgap_useweaponvalue: 0,
  cl_fixedcrosshairgap: 3,
  cl_crosshair_dynamic_maxdist_splitratio: 1,
  cl_crosshair_dynamic_splitalpha_innermod: 0,
  cl_crosshair_dynamic_splitalpha_outermod: 1,
  cl_crosshair_dynamic_splitdist: 3,
};

let n = 0;
function freshDataDir() {
  const dir = path.join(tmpRoot, `case-${n++}`);
  fs.mkdirSync(dir, { recursive: true });
  process.env.DATA_DIR = dir;
  return dir;
}

function writeLegacyFiles(dir, { withSubmission = false } = {}) {
  fs.writeFileSync(path.join(dir, 'presets.json'), JSON.stringify({
    presets: [
      { id: 'p1', name: 'BILDSCHIRMFRESSER', params: { ...LEGACY_PRESET_PARAMS } },
      { id: 'p2', name: 'Neu', params: { ...GREEN_RESTORE_PARAMS } },
    ],
    restore: { params: { ...LEGACY_RESTORE_PARAMS } },
    keys: { next: 'f7', restore: 'f8' },
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'submissions.json'), JSON.stringify({
    submissions: withSubmission
      ? [{ id: 's1', submitterName: 'x', presetName: 'Alt', params: { ...LEGACY_PRESET_PARAMS }, submittedAt: '2026-01-01T00:00:00.000Z', status: 'pending' }]
      : [],
  }));
}

function backupsIn(dir, file) {
  return fs.readdirSync(dir).filter((f) => f.startsWith(`${file}.pre-cs2-update-`) && f.endsWith('.bak'));
}

// console.log der Migration im Test stumm schalten
const origLog = console.log;
test.before(() => { console.log = () => {}; });
test.after(() => { console.log = origLog; });

test('readState migrates legacy presets + restore, writes backup and marks entries', () => {
  const dir = freshDataDir();
  writeLegacyFiles(dir);
  const before = fs.readFileSync(path.join(dir, 'presets.json'), 'utf8');

  const s = state.readState();

  // in-memory
  assert.equal(isLegacyParams(s.presets[0].params), false);
  assert.equal(s.presets[0].migrated, true);
  assert.deepEqual(Object.keys(s.presets[0].params).sort(), [...CVAR_KEYS].sort());
  assert.equal(s.presets[0].params.cl_crosshair_screen_height, state.LEGACY_SCREEN_HEIGHT);
  assert.equal(s.presets[0].params.cl_crosshair_length, 255);
  assert.equal(s.presets[1].migrated, undefined, 'already-new preset is not marked');
  assert.deepEqual(s.restore.params, GREEN_RESTORE_PARAMS);
  assert.equal(s.restore.migrated, true);

  // on disk
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'presets.json'), 'utf8'));
  assert.equal(isLegacyParams(onDisk.presets[0].params), false);
  assert.equal(onDisk.presets[0].migrated, true);
  assert.equal(isLegacyParams(onDisk.restore.params), false);

  // backup = exact pre-migration content
  const baks = backupsIn(dir, 'presets.json');
  assert.equal(baks.length, 1);
  assert.match(baks[0], /^presets\.json\.pre-cs2-update-\d{8}\.bak$/);
  assert.equal(fs.readFileSync(path.join(dir, baks[0]), 'utf8'), before);
});

test('migration is idempotent: second read changes nothing, no second backup', () => {
  const dir = freshDataDir();
  writeLegacyFiles(dir);
  state.readState();
  const afterFirst = fs.readFileSync(path.join(dir, 'presets.json'), 'utf8');
  const bakContent = fs.readFileSync(path.join(dir, backupsIn(dir, 'presets.json')[0]), 'utf8');

  const s2 = state.readState();
  assert.equal(fs.readFileSync(path.join(dir, 'presets.json'), 'utf8'), afterFirst);
  assert.equal(backupsIn(dir, 'presets.json').length, 1);
  assert.equal(fs.readFileSync(path.join(dir, backupsIn(dir, 'presets.json')[0]), 'utf8'), bakContent);
  assert.equal(s2.presets[0].migrated, true);
});

test('readState without legacy data neither writes nor creates a backup', () => {
  const dir = freshDataDir();
  const fresh = {
    presets: [{ id: 'p', name: 'Neu', params: { ...GREEN_RESTORE_PARAMS } }],
    restore: { params: { ...GREEN_RESTORE_PARAMS } },
    keys: { next: 'f7', restore: 'f8' },
  };
  fs.writeFileSync(path.join(dir, 'presets.json'), JSON.stringify(fresh));
  fs.writeFileSync(path.join(dir, 'submissions.json'), JSON.stringify({ submissions: [] }));
  const raw = fs.readFileSync(path.join(dir, 'presets.json'), 'utf8');
  state.readState();
  assert.equal(fs.readFileSync(path.join(dir, 'presets.json'), 'utf8'), raw);
  assert.equal(backupsIn(dir, 'presets.json').length, 0);
});

test('readSubmissions migrates legacy submissions with its own backup', () => {
  const dir = freshDataDir();
  writeLegacyFiles(dir, { withSubmission: true });
  const data = state.readSubmissions();
  assert.equal(isLegacyParams(data.submissions[0].params), false);
  assert.equal(data.submissions[0].migrated, true);
  assert.equal(backupsIn(dir, 'submissions.json').length, 1);
  assert.equal(backupsIn(dir, 'presets.json').length, 0, 'presets untouched by readSubmissions');
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'submissions.json'), 'utf8'));
  assert.equal(isLegacyParams(onDisk.submissions[0].params), false);
});

test('readState normalizes params of already-new entries (missing keys -> defaults)', () => {
  const dir = freshDataDir();
  fs.writeFileSync(path.join(dir, 'presets.json'), JSON.stringify({
    presets: [{ id: 'p', name: 'Halb', params: { cl_crosshair_length: 999, cl_crosshair_thickness: 3, junk: 1 } }],
    restore: { params: { ...GREEN_RESTORE_PARAMS } },
    keys: { next: 'f7', restore: 'f8' },
  }));
  fs.writeFileSync(path.join(dir, 'submissions.json'), JSON.stringify({ submissions: [] }));
  const s = state.readState();
  assert.equal(s.presets[0].params.cl_crosshair_length, 255);
  assert.equal(s.presets[0].params.cl_crosshair_gap, 4);
  assert.equal('junk' in s.presets[0].params, false);
  assert.equal(s.presets[0].migrated, undefined);
});
