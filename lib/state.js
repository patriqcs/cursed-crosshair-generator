'use strict';

const crypto = require('crypto');
const storage = require('./storage');
const defaults = require('./defaults');
const { validateParams, sanitizePresetName, sanitizeSubmitterName } = require('./validation');
const { normalizeParams, isLegacyParams, defaultParams, fillMissingOutline } = require('./cvars');
const { migrateLegacyParams } = require('./migrate');

const PRESETS_FILE = 'presets.json';
const SUBMISSIONS_FILE = 'submissions.json';

// Bildschirmhoehe, auf die die alten Presets (Cvar-Satz vor 2026-09-22) entworfen
// wurden: Spielaufloesung des Streamers. Die Migration rechnet die alten
// Source-Einheiten auf Pixel bei genau dieser Hoehe um.
const LEGACY_SCREEN_HEIGHT = 960;

function newId() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

function nowIso() {
  return new Date().toISOString();
}

function yyyymmdd() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function backupName(file) {
  return `${file}.pre-cs2-update-${yyyymmdd()}.bak`;
}

// Einmalige Migration alter Params in einer Datei. `entries` = alle Objekte mit
// `.params` (Presets, Restore, Submissions). Bei Treffern: Backup (nur wenn noch
// nicht vorhanden), Params migrieren, `migrated: true` als Marker fuer die
// Admin-UI, Datei zurueckschreiben. Idempotent: nach dem Lauf ist nichts mehr legacy.
function migrateLegacyEntries(file, data, entries) {
  const legacy = entries.filter((e) => e && isLegacyParams(e.params));
  if (legacy.length === 0) return;
  const bak = backupName(file);
  const created = storage.backupFileOnceSync(file, bak);
  for (const e of legacy) {
    e.params = migrateLegacyParams(e.params, { screenHeight: LEGACY_SCREEN_HEIGHT });
    e.migrated = true;
  }
  storage.writeJsonAtomicSync(file, data);
  // eslint-disable-next-line no-console
  console.log(
    `[INFO] ${file}: ${legacy.length} Eintrag/Eintraege auf das CS2-Crosshair-System `
    + `(2026-09-22) migriert, screen_height ${LEGACY_SCREEN_HEIGHT}`
    + (created ? `, Backup: ${bak}` : ''),
  );
}

// Params beim Lesen absichern: unbekannte Keys weg, fehlende -> Default, Range
// geclampt. Unbrauchbare Params (nicht-numerisch) werden durch Defaults ersetzt.
// Eintraege von vor dem Update vom 2026-09-30 haben keine Outline-Farbe: sie bekommen
// Schwarz mit der Deckkraft des Crosshairs (so sahen sie aus, siehe fillMissingOutline).
function safeParams(params, label) {
  const p = normalizeParams(fillMissingOutline(params));
  if (p) return p;
  // eslint-disable-next-line no-console
  console.warn(`[WARN] ${label}: ungueltige Params, auf Defaults zurueckgesetzt`);
  return defaultParams();
}

function ensureSeed() {
  const presets = storage.readJsonSync(PRESETS_FILE, null);
  if (!presets) {
    const seed = {
      presets: [
        {
          id: newId(),
          name: 'Inferno',
          params: defaults.clone(defaults.STARTER_PRESET_PARAMS),
        },
      ],
      restore: { params: defaults.clone(defaults.GREEN_RESTORE_PARAMS) },
      keys: { ...defaults.DEFAULT_KEYS },
    };
    storage.writeJsonAtomicSync(PRESETS_FILE, seed);
  }
  const subs = storage.readJsonSync(SUBMISSIONS_FILE, null);
  if (!subs) {
    storage.writeJsonAtomicSync(SUBMISSIONS_FILE, { submissions: [] });
  }
}

function readState() {
  ensureSeed();
  const data = storage.readJsonSync(PRESETS_FILE, {
    presets: [],
    restore: { params: defaults.clone(defaults.GREEN_RESTORE_PARAMS) },
    keys: { ...defaults.DEFAULT_KEYS },
  });
  if (!Array.isArray(data.presets)) data.presets = [];
  if (!data.restore || typeof data.restore !== 'object') {
    data.restore = { params: defaults.clone(defaults.GREEN_RESTORE_PARAMS) };
  }
  if (!data.keys || typeof data.keys !== 'object') data.keys = { ...defaults.DEFAULT_KEYS };

  migrateLegacyEntries(PRESETS_FILE, data, [...data.presets, data.restore]);

  for (const p of data.presets) p.params = safeParams(p.params, `Preset ${p.id}`);
  data.restore.params = safeParams(data.restore.params, 'Restore');
  return data;
}

function writeState(state) {
  storage.writeJsonAtomicSync(PRESETS_FILE, state);
}

function readSubmissions() {
  ensureSeed();
  const data = storage.readJsonSync(SUBMISSIONS_FILE, { submissions: [] });
  if (!Array.isArray(data.submissions)) data.submissions = [];

  migrateLegacyEntries(SUBMISSIONS_FILE, data, data.submissions);

  for (const s of data.submissions) s.params = safeParams(s.params, `Submission ${s.id}`);
  return data;
}

function writeSubmissions(data) {
  storage.writeJsonAtomicSync(SUBMISSIONS_FILE, data);
}

// Validate a full preset (name + params); returns sanitized object or null.
function validatePresetInput(input) {
  if (!input || typeof input !== 'object') return null;
  const name = sanitizePresetName(input.name);
  if (!name) return null;
  const params = validateParams(input.params);
  if (!params) return null;
  return { name, params };
}

function validateSubmissionInput(input) {
  if (!input || typeof input !== 'object') return null;
  const submitterName = sanitizeSubmitterName(input.submitterName);
  if (!submitterName) return null;
  const presetName = sanitizePresetName(input.presetName);
  if (!presetName) return null;
  const params = validateParams(input.params);
  if (!params) return null;
  return { submitterName, presetName, params };
}

// Restore benutzt dasselbe Param-Schema wie Presets (seit 2026-09-22 keine Extra-Felder).
function validateRestoreInput(input) {
  if (!input || typeof input !== 'object') return null;
  const params = validateParams(input.params);
  if (!params) return null;
  return { params };
}

function validateKeysInput(input) {
  if (!input || typeof input !== 'object') return null;
  const next = String(input.next || '').trim().toLowerCase();
  const restore = String(input.restore || '').trim().toLowerCase();
  // Source engine bind keys are typically letters/digits or special tokens
  if (!/^[a-z0-9_]{1,32}$/.test(next)) return null;
  if (!/^[a-z0-9_]{1,32}$/.test(restore)) return null;
  return { next, restore };
}

module.exports = {
  newId,
  nowIso,
  ensureSeed,
  readState,
  writeState,
  readSubmissions,
  writeSubmissions,
  validatePresetInput,
  validateSubmissionInput,
  validateRestoreInput,
  validateKeysInput,
  LEGACY_SCREEN_HEIGHT,
};
