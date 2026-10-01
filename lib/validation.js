'use strict';

const { CVARS, CVAR_KEYS, normalizeParams, fillMissingOutline } = require('./cvars');

const CONTROL_CHARS = /[\x00-\x1F\x7F-\x9F]+/g;

function stripControl(str) {
  if (typeof str !== 'string') return '';
  return str.replace(CONTROL_CHARS, '');
}

function sanitizeName(str, { min, max }) {
  if (typeof str !== 'string') return null;
  const cleaned = stripControl(str).trim();
  if (cleaned.length < min || cleaned.length > max) return null;
  return cleaned;
}

// Reject cfg-injection chars (`"` `;`) AND HTML angle brackets — letztere sind
// zwar im .cfg harmlos, aber so liegt der Name nie als XSS-Payload im State
// (zweite Verteidigungslinie neben dem clientseitigen escapeHtml).
function hasUnsafeNameChar(s) {
  return s.includes('"') || s.includes(';') || s.includes('<') || s.includes('>');
}

function sanitizePresetName(str) {
  const base = sanitizeName(str, { min: 2, max: 60 });
  if (!base) return null;
  if (hasUnsafeNameChar(base)) return null;
  return base;
}

function sanitizeSubmitterName(str) {
  const base = sanitizeName(str, { min: 2, max: 40 });
  if (!base) return null;
  // Submitter name is embedded into the .cfg echo line for each preset — reject
  // characters that would close the alias body (`"`) or chain a new command (`;`),
  // plus HTML angle brackets (XSS defense-in-depth in the admin view).
  if (hasUnsafeNameChar(base)) return null;
  return base;
}

function hasInjection(value) {
  if (typeof value !== 'string') return false;
  return value.includes('"') || value.includes(';');
}

// Enum-Cvars (style, drawoutline) haben zusammenhaengende Wertebereiche; damit
// Out-of-Range wie bei int/float geclampt statt abgelehnt wird, vorab auf
// min..max der erlaubten Werte ziehen. Nicht-numerisches bleibt unangetastet
// (normalizeParams lehnt es dann ab).
function preclampEnum(key, raw) {
  const spec = CVARS[key];
  if (spec.type !== 'enum') return raw;
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n)) return raw;
  const lo = Math.min(...spec.values);
  const hi = Math.max(...spec.values);
  return Math.min(Math.max(Math.round(n), lo), hi);
}

// Validiert ein Param-Objekt gegen das gemeinsame Cvar-Modell (public/js/cvars.js).
// Presets, Submissions und Restore benutzen dasselbe Schema (alle CVAR_KEYS).
//  - unbekannte Keys werden verworfen
//  - fehlende Keys bekommen den Cvar-Default
//  - Zahlen werden auf die Cvar-Range geclampt (nie wegen Range abgelehnt)
//  - nicht-numerische Werte -> null (abgelehnt)
//  - Injection-Zeichen (" ;) in Strings -> null (cfg-Injection-Guard)
// Die `restore`-Option bleibt aus Kompatibilitaet erhalten, hat aber keine Wirkung.
function validateParams(input, _opts = {}) {
  if (!input || typeof input !== 'object') return null;
  // Clients mit JS von vor dem 2026-09-30 (offener Tab) schicken keine Outline-Farbe; ihre
  // Vorschau zeigte Schwarz mit Crosshair-Alpha. Aktuelle Clients schicken immer alle Keys.
  const src = fillMissingOutline(input);
  const cleaned = {};
  for (const key of CVAR_KEYS) {
    const raw = src[key];
    if (hasInjection(raw)) return null;
    cleaned[key] = preclampEnum(key, raw);
  }
  return normalizeParams(cleaned);
}

module.exports = {
  sanitizePresetName,
  sanitizeSubmitterName,
  validateParams,
};
