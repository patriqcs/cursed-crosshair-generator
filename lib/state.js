'use strict';

const crypto = require('crypto');
const storage = require('./storage');
const defaults = require('./defaults');
const { validateParams, sanitizePresetName, sanitizeSubmitterName } = require('./validation');

const PRESETS_FILE = 'presets.json';
const SUBMISSIONS_FILE = 'submissions.json';

function newId() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

function nowIso() {
  return new Date().toISOString();
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
  return storage.readJsonSync(PRESETS_FILE, {
    presets: [],
    restore: { params: defaults.clone(defaults.GREEN_RESTORE_PARAMS) },
    keys: { ...defaults.DEFAULT_KEYS },
  });
}

function writeState(state) {
  storage.writeJsonAtomicSync(PRESETS_FILE, state);
}

function readSubmissions() {
  ensureSeed();
  const data = storage.readJsonSync(SUBMISSIONS_FILE, { submissions: [] });
  if (!Array.isArray(data.submissions)) data.submissions = [];
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

function validateRestoreInput(input) {
  if (!input || typeof input !== 'object') return null;
  const params = validateParams(input.params, { restore: true });
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
};
