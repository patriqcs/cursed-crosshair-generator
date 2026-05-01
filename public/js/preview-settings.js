// Preview rendering settings — global, persistent in localStorage.
//
// Aktuell: Zoom-Level. Beeinflusst nur den darzustellenden Ausschnitt der
// Preview (viewBox-Crop), nicht die Render-Mathematik. Die Crosshair-Geometrie
// bleibt pixelgenau zur CS2-1280x960-Renderaufloesung — der Zoom zoomt nur
// die *Kamera* auf das Zentrum.

const ZOOM_OPTIONS = [1, 2, 3, 4, 6, 8];
const DEFAULT_ZOOM = 1;
const STORAGE_KEY = 'ccg.preview.zoom';

let currentZoom = readZoom();

function readZoom() {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEY));
    if (ZOOM_OPTIONS.includes(v)) return v;
  } catch (_e) { /* ignore */ }
  return DEFAULT_ZOOM;
}

function writeZoom(z) {
  try { localStorage.setItem(STORAGE_KEY, String(z)); } catch (_e) { /* ignore */ }
}

const listeners = new Set();

function setZoom(z) {
  if (!ZOOM_OPTIONS.includes(z) || z === currentZoom) return;
  currentZoom = z;
  writeZoom(z);
  for (const fn of listeners) {
    try { fn(); } catch (_e) { /* ignore */ }
  }
}

export function getSettings() {
  return { zoom: currentZoom };
}

export function getHorizontalStretch() {
  return 1;
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Wrapper-Container fuer Preview-Controls. Reihenfolge: extraSlot (i.d.R.
// der Background-Selector) zuerst, dann Zoom-Selector.
export function buildPreviewControls(extraSlot = null) {
  const wrap = document.createElement('div');
  wrap.className = 'preview-controls';

  if (extraSlot) wrap.appendChild(extraSlot);

  const zoomLabel = document.createElement('span');
  const lbl = document.createElement('label');
  lbl.textContent = 'Zoom';
  const select = document.createElement('select');
  select.className = 'bg-select';
  for (const z of ZOOM_OPTIONS) {
    const opt = document.createElement('option');
    opt.value = String(z);
    // Zoom 1x heisst im UI "Original" — entspricht dem nativen
    // 1280x960-Frame ohne Crop.
    opt.textContent = z === 1 ? 'Original' : `${z}×`;
    if (z === currentZoom) opt.selected = true;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => setZoom(Number(select.value)));
  zoomLabel.appendChild(lbl);
  zoomLabel.appendChild(select);
  wrap.appendChild(zoomLabel);

  return wrap;
}
