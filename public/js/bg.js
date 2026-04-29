// Map background selector. Each background has a CSS gradient fallback that
// approximates the map's color palette. If `/static/img/maps/<slug>.jpg`
// exists, the actual image is used on top of the gradient.
//
// Der Hintergrund wird in einem absolut positionierten Child-Layer gesetzt
// (.preview-bg-layer). Das erlaubt CSS `transform: scale()`, sodass der
// Hintergrund mit dem SVG-Crosshair-Zoom mit-zoomt — ohne das Aspect-Ratio
// zu verlieren wie bei direktem `background-size: 100% 100%`.

import { onChange as onPreviewChange, getSettings } from './preview-settings.js';

// Backgrounds — nur Maps mit existierendem Screenshot in
// public/img/maps/<slug>.jpg. Fehlende Maps werden NICHT angezeigt, damit
// der Selector kein Auswahlitem ohne tatsaechliches Bild enthaelt.
export const BACKGROUNDS = [
  { slug: 'cache',    label: 'Cache',     gradient: 'linear-gradient(135deg, #8a8a82 0%, #5e6260 50%, #2a2c2a 100%)' },
  { slug: 'mirage',   label: 'Mirage',    gradient: 'linear-gradient(135deg, #d9b779 0%, #b08850 50%, #5e4226 100%)' },
  { slug: 'inferno',  label: 'Inferno',   gradient: 'linear-gradient(135deg, #c46b3a 0%, #8a3d1e 50%, #3e2014 100%)' },
  { slug: 'nuke',     label: 'Nuke',      gradient: 'linear-gradient(135deg, #7c8590 0%, #4a525e 50%, #1f242c 100%)' },
  { slug: 'ancient',  label: 'Ancient',   gradient: 'linear-gradient(135deg, #5a8a4a 0%, #3a5e30 50%, #1c2e18 100%)' },
  { slug: 'anubis',   label: 'Anubis',    gradient: 'linear-gradient(135deg, #d4a04a 0%, #8a6320 50%, #3e2c10 100%)' },
  { slug: 'dust2',    label: 'Dust2',     gradient: 'linear-gradient(135deg, #c8a368 0%, #a07b46 50%, #6e4f2d 100%)' },
];

const DEFAULT_SLUG = BACKGROUNDS[0].slug;

const STORAGE_KEY = 'ccg.preview.background';

export function getActiveBg() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && BACKGROUNDS.find((b) => b.slug === v)) return v;
  } catch (_e) { /* ignore */ }
  // Falls in localStorage ein nicht mehr existierender slug steht (z.B.
  // 'none' aus alten Versionen), faellt der Selector auf den ersten
  // verfuegbaren Background zurueck.
  return DEFAULT_SLUG;
}

export function setActiveBg(slug) {
  try { localStorage.setItem(STORAGE_KEY, slug); } catch (_e) { /* ignore */ }
}

// Versucht Bilder in dieser Reihenfolge: jpg, jpeg, png, webp.
// Erstes erfolgreich geladenes wird als Background gesetzt; sonst Gradient.
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];

function tryLoadFirstAvailable(slug, extensions, onSuccess, onAllFailed) {
  let i = 0;
  const next = () => {
    if (i >= extensions.length) { onAllFailed(); return; }
    const url = `/static/img/maps/${slug}.${extensions[i++]}`;
    const img = new Image();
    img.onload = () => onSuccess(url);
    img.onerror = next;
    img.src = url;
  };
  next();
}

// Track aller Preview-Elemente mit aktivem Background, damit setZoom() die
// transform-scale auf den Bg-Layern aktualisieren kann.
const trackedPreviews = new Set();

function ensureBgLayer(previewEl) {
  let layer = previewEl.querySelector(':scope > .preview-bg-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'preview-bg-layer';
    // Hinten einfuegen (vor SVG / anderen Children)
    previewEl.insertBefore(layer, previewEl.firstChild);
  }
  return layer;
}

function applyZoomToLayer(layer, zoom) {
  layer.style.transform = `scale(${zoom})`;
}

// Apply background to a single .preview element.
export function applyBg(previewEl, slug) {
  const bg = BACKGROUNDS.find((b) => b.slug === slug) || BACKGROUNDS[0];
  const layer = ensureBgLayer(previewEl);
  trackedPreviews.add(previewEl);
  applyZoomToLayer(layer, getSettings().zoom);

  tryLoadFirstAvailable(
    bg.slug,
    IMAGE_EXTENSIONS,
    (url) => {
      layer.style.backgroundImage = `url("${url}")`;
      layer.style.backgroundSize = 'cover';
      layer.style.backgroundPosition = 'center';
      previewEl.classList.add('preview-with-bg');
    },
    () => {
      layer.style.backgroundImage = bg.gradient;
      layer.style.backgroundSize = '';
      layer.style.backgroundPosition = '';
      previewEl.classList.add('preview-with-bg');
    },
  );
}

// Bei globalem Zoom-Wechsel den scale() aller getrackten Bg-Layer anpassen.
onPreviewChange(() => {
  const z = getSettings().zoom;
  for (const previewEl of trackedPreviews) {
    if (!previewEl.isConnected) {
      trackedPreviews.delete(previewEl);
      continue;
    }
    const layer = previewEl.querySelector(':scope > .preview-bg-layer');
    if (layer) applyZoomToLayer(layer, z);
  }
});

// Build a <select> element bound to localStorage and apply changes to one or
// more preview elements. Returns the select node so the caller can place it.
export function buildBgSelector(previewEls) {
  const targets = Array.isArray(previewEls) ? previewEls : [previewEls];
  const select = document.createElement('select');
  select.className = 'bg-select';
  for (const bg of BACKGROUNDS) {
    const opt = document.createElement('option');
    opt.value = bg.slug;
    opt.textContent = bg.label;
    select.appendChild(opt);
  }
  select.value = getActiveBg();
  for (const t of targets) applyBg(t, select.value);
  select.addEventListener('change', () => {
    setActiveBg(select.value);
    for (const t of targets) applyBg(t, select.value);
  });
  return select;
}
