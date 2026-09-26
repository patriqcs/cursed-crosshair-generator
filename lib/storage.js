'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

function dataDir() {
  return process.env.DATA_DIR || DEFAULT_DATA_DIR;
}

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function filePath(name) {
  return path.join(dataDir(), name);
}

function readJsonSync(name, fallback) {
  const fullPath = filePath(name);
  try {
    const raw = fs.readFileSync(fullPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

function writeJsonAtomicSync(name, value) {
  ensureDirSync(dataDir());
  const fullPath = filePath(name);
  const tmpPath = `${fullPath}.tmp`;
  const data = JSON.stringify(value, null, 2);
  const fd = fs.openSync(tmpPath, 'w');
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, fullPath);
}

function readTextSync(name) {
  try {
    return fs.readFileSync(filePath(name), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// Atomar (tmp+fsync+rename), analog writeJsonAtomicSync. Optional `mode` setzt
// restriktive Permissions für sensible Dateien (Session-Secret, Credentials).
function writeTextSync(name, text, { mode } = {}) {
  ensureDirSync(dataDir());
  const fullPath = filePath(name);
  const tmpPath = `${fullPath}.tmp`;
  const fd = fs.openSync(tmpPath, 'w', mode != null ? mode : 0o644);
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, fullPath);
  if (mode != null) {
    try { fs.chmodSync(fullPath, mode); } catch { /* best effort (z.B. FS ohne chmod) */ }
  }
}

// Kopiert eine Datei im Data-Dir nach `backupName`, falls das Backup noch nicht
// existiert (COPYFILE_EXCL). Rueckgabe: true = Backup angelegt, false = war schon da
// oder Quelle fehlt.
function backupFileOnceSync(name, backupName) {
  const src = filePath(name);
  const dst = filePath(backupName);
  try {
    fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL);
    return true;
  } catch (err) {
    if (err.code === 'EEXIST' || err.code === 'ENOENT') return false;
    throw err;
  }
}

module.exports = {
  dataDir,
  backupFileOnceSync,
  ensureDirSync,
  readJsonSync,
  writeJsonAtomicSync,
  readTextSync,
  writeTextSync,
};
