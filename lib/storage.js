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

function writeTextSync(name, text) {
  ensureDirSync(dataDir());
  fs.writeFileSync(filePath(name), text, { encoding: 'utf8' });
}

module.exports = {
  dataDir,
  ensureDirSync,
  readJsonSync,
  writeJsonAtomicSync,
  readTextSync,
  writeTextSync,
};
