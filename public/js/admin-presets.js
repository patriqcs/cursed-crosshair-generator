import { buildEditor, clone } from './editor.js';
import { renderCrosshair, ensureSvg, registerForRerender } from './preview.js';
import { api } from './api.js';
import { toast } from './toast.js';
import { buildBgSelector } from './bg.js';
import { openShareCodeModal } from './sharecode-ui.js';
import { buildPreviewControls } from './preview-settings.js';
import { confirmDialog } from './confirm.js';
import { openCfgImportModal } from './cfg-import-ui.js';

// Module state for the Presets tab.
const ps = {
  data: { presets: [], restore: { params: {} }, keys: { next: 'o', restore: 'p' } },
  selectedId: null,
  saveTimer: null,
  saving: false,
};

let activePreviewSvg;

function autosaveLater() {
  const indicator = document.getElementById('autosave');
  if (indicator) indicator.textContent = '• unsaved';
  clearTimeout(ps.saveTimer);
  ps.saveTimer = setTimeout(saveStateNow, 500);
}

async function saveStateNow() {
  if (ps.saving) {
    autosaveLater();
    return;
  }
  ps.saving = true;
  const indicator = document.getElementById('autosave');
  if (indicator) indicator.textContent = '• saving...';
  try {
    await api.put('/api/admin/state', ps.data);
    // ps.data NICHT mit der Server-Antwort ueberschreiben! Editor-Listener
    // und Slider halten via Closure Referenzen auf das aktuelle params-Objekt.
    // Wuerde ps.data ersetzt, schreiben Slider danach in detached Objekte
    // und nichts persistiert mehr — die UI haengt bis zum Reload.
    if (indicator) indicator.textContent = '• saved';
    setTimeout(() => { if (indicator && indicator.textContent === '• saved') indicator.textContent = ''; }, 1500);
  } catch (err) {
    if (indicator) indicator.textContent = '• save failed';
    toast(`Save failed: ${err.message}`, 'err');
  } finally {
    ps.saving = false;
  }
}

function renderPresetList() {
  const host = document.getElementById('preset-list');
  host.innerHTML = '';
  if (ps.data.presets.length === 0) {
    host.appendChild(emptyEl('No presets yet. Add one to get started.'));
    return;
  }
  ps.data.presets.forEach((preset, idx) => {
    const row = document.createElement('div');
    row.className = 'preset-row' + (preset.id === ps.selectedId ? ' selected' : '');
    row.dataset.id = preset.id;

    const mini = document.createElement('div');
    mini.className = 'preview-mini';
    const svg = ensureSvg(mini);
    renderCrosshair(svg, preset.params);
    row.appendChild(mini);

    const meta = document.createElement('div');
    meta.className = 'preset-meta';
    const name = document.createElement('div');
    name.className = 'preset-name';
    name.textContent = preset.name;
    name.title = preset.name;
    meta.appendChild(name);
    const subText = preset.submittedBy ? `by ${preset.submittedBy}` : `style ${preset.params.cl_crosshairstyle}`;
    const sub = document.createElement('div');
    sub.className = 'preset-sub';
    sub.textContent = subText;
    sub.title = subText;
    meta.appendChild(sub);
    row.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'preset-actions';
    actions.appendChild(iconBtn('↑', 'Move up', (e) => { e.stopPropagation(); movePreset(preset.id, 'up'); }, idx === 0));
    actions.appendChild(iconBtn('↓', 'Move down', (e) => { e.stopPropagation(); movePreset(preset.id, 'down'); }, idx === ps.data.presets.length - 1));
    actions.appendChild(iconBtn('⧉', 'Duplicate', (e) => { e.stopPropagation(); duplicatePreset(preset.id); }));
    actions.appendChild(iconBtn('×', 'Delete', (e) => { e.stopPropagation(); deletePreset(preset.id); }));
    row.appendChild(actions);

    row.addEventListener('click', () => selectPreset(preset.id));
    host.appendChild(row);
  });
}

function iconBtn(label, title, onClick, disabled = false) {
  const b = document.createElement('button');
  b.className = 'btn btn-icon btn-sm';
  b.type = 'button';
  b.textContent = label;
  b.title = title;
  if (disabled) b.disabled = true;
  b.addEventListener('click', onClick);
  return b;
}

function emptyEl(text) {
  const d = document.createElement('div');
  d.className = 'empty-state';
  d.textContent = text;
  return d;
}

function selectPreset(id) {
  ps.selectedId = id;
  renderPresetList();
  renderActiveEditor();
  renderActivePreview();
  updateCounter();
}

function selectedPreset() {
  return ps.data.presets.find((p) => p.id === ps.selectedId) || null;
}

function renderActiveEditor() {
  const host = document.getElementById('admin-editor');
  const preset = selectedPreset();
  const card = document.getElementById('admin-editor-card');
  if (!preset) {
    card.style.display = 'none';
    return;
  }
  card.style.display = '';
  document.getElementById('active-preset-name').textContent = preset.name;
  document.getElementById('active-name').value = preset.name;
  buildEditor(host, preset.params, () => {
    renderActivePreview();
    autosaveLater();
  });
}

function renderActivePreview() {
  const preset = selectedPreset();
  if (!activePreviewSvg) activePreviewSvg = ensureSvg(document.getElementById('admin-preview'));
  if (preset) {
    renderCrosshair(activePreviewSvg, preset.params);
    document.getElementById('active-preset-name').textContent = preset.name;
  } else {
    renderCrosshair(activePreviewSvg, null);
  }
}

function updateCounter() {
  document.getElementById('preset-counter').textContent =
    `${ps.data.presets.length} preset${ps.data.presets.length === 1 ? '' : 's'}`;
}

function addPreset() {
  const newPreset = {
    id: `tmp-${Date.now()}`,
    name: `Preset ${ps.data.presets.length + 1}`,
    params: clone(ps.data.restore && ps.data.restore.params ? ps.data.restore.params : {}),
  };
  // Strip restore-only keys so it validates as a regular preset
  const RESTORE_ONLY = [
    'cl_crosshairgap_useweaponvalue', 'cl_fixedcrosshairgap',
    'cl_crosshair_dynamic_maxdist_splitratio',
    'cl_crosshair_dynamic_splitalpha_innermod',
    'cl_crosshair_dynamic_splitalpha_outermod',
  ];
  for (const k of RESTORE_ONLY) delete newPreset.params[k];
  if (newPreset.params.cl_crosshair_dynamic_splitdist === undefined) newPreset.params.cl_crosshair_dynamic_splitdist = null;
  ps.data.presets = [...ps.data.presets, newPreset];
  ps.selectedId = newPreset.id;
  renderPresetList();
  renderActiveEditor();
  renderActivePreview();
  updateCounter();
  autosaveLater();
}

function duplicatePreset(id) {
  const orig = ps.data.presets.find((p) => p.id === id);
  if (!orig) return;
  const dup = {
    id: `tmp-${Date.now()}`,
    name: `${orig.name} (copy)`,
    params: clone(orig.params),
  };
  if (orig.submittedBy) dup.submittedBy = orig.submittedBy;
  const idx = ps.data.presets.findIndex((p) => p.id === id);
  const presets = [...ps.data.presets];
  presets.splice(idx + 1, 0, dup);
  ps.data.presets = presets;
  ps.selectedId = dup.id;
  renderPresetList();
  renderActiveEditor();
  renderActivePreview();
  updateCounter();
  autosaveLater();
}

async function deletePreset(id) {
  const preset = ps.data.presets.find((p) => p.id === id);
  if (!preset) return;
  const ok = await confirmDialog({
    title: 'Delete preset',
    message: `Delete "${preset.name}"? This cannot be undone (but you can re-add it from the Approved Crosshairs tab if it was once a submission).`,
    okLabel: 'Delete',
  });
  if (!ok) return;
  ps.data.presets = ps.data.presets.filter((p) => p.id !== id);
  if (ps.selectedId === id) {
    ps.selectedId = ps.data.presets.length > 0 ? ps.data.presets[0].id : null;
  }
  renderPresetList();
  renderActiveEditor();
  renderActivePreview();
  updateCounter();
  autosaveLater();
}

function movePreset(id, direction) {
  const idx = ps.data.presets.findIndex((p) => p.id === id);
  if (idx === -1) return;
  const target = direction === 'up' ? idx - 1 : idx + 1;
  if (target < 0 || target >= ps.data.presets.length) return;
  const presets = [...ps.data.presets];
  const [moved] = presets.splice(idx, 1);
  presets.splice(target, 0, moved);
  ps.data.presets = presets;
  renderPresetList();
  autosaveLater();
}

function bindNameInput() {
  const inp = document.getElementById('active-name');
  inp.addEventListener('input', () => {
    const preset = selectedPreset();
    if (!preset) return;
    preset.name = inp.value;
    document.getElementById('active-preset-name').textContent = preset.name;
    // re-render list label without losing focus
    const row = document.querySelector(`.preset-row[data-id="${preset.id}"] .preset-name`);
    if (row) row.textContent = preset.name;
    autosaveLater();
  });
}

async function exportCfg() {
  try {
    const res = await fetch('/api/admin/export', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('export_failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cc.cfg';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    toast('Exported cc.cfg', 'ok');
  } catch (err) {
    toast(`Export failed: ${err.message}`, 'err');
  }
}

// =========================================================================
// Restore + Keys modals
// =========================================================================

let restorePreviewSvg;
let restoreDraft;

function rerenderRestore() {
  if (restorePreviewSvg && restoreDraft) {
    renderCrosshair(restorePreviewSvg, restoreDraft);
  }
}

function openRestoreModal() {
  restoreDraft = clone(ps.data.restore.params);
  if (!restorePreviewSvg) restorePreviewSvg = ensureSvg(document.getElementById('restore-preview'));
  renderCrosshair(restorePreviewSvg, restoreDraft);
  buildEditor(document.getElementById('restore-editor'), restoreDraft, rerenderRestore);
  document.getElementById('restore-modal').classList.add('open');
}

// Einmaliges Setup: Background- + Zoom-Selector ueber dem Preview, plus
// Import/Export-Code-Button. Wird in init() aufgerufen wenn das Modal noch
// geschlossen ist — die Controls/Listeners persistieren ueber Modal-Open/Close.
function setupRestoreModalControls() {
  const previewEl = document.getElementById('restore-preview');
  if (!previewEl) return;
  if (!restorePreviewSvg) restorePreviewSvg = ensureSvg(previewEl);

  // Background + Zoom (gleicher Stack wie auf der Haupt-Preview).
  const bgSelect = buildBgSelector([previewEl]);
  bgSelect.id = 'restore-bg-select';
  const bgWrap = document.createElement('span');
  bgWrap.style.display = 'inline-flex';
  bgWrap.style.alignItems = 'center';
  bgWrap.style.gap = '6px';
  const bgLabel = document.createElement('label');
  bgLabel.className = 'muted';
  bgLabel.style.margin = '0';
  bgLabel.textContent = 'Background';
  bgWrap.appendChild(bgLabel);
  bgWrap.appendChild(bgSelect);

  const controls = buildPreviewControls(bgWrap);
  const ctlHost = document.getElementById('restore-preview-controls-host');
  if (ctlHost) ctlHost.appendChild(controls);

  // Live-Rerender bei Zoom-Aenderung (auch wenn Modal geschlossen ist —
  // schadet nicht, restoreDraft ist dann undefined und renderCrosshair
  // returnt early).
  registerForRerender(restorePreviewSvg, () => restoreDraft || null);

  // Import/Export-Code-Button. Importierte Params werden in den restoreDraft
  // gemerged (statt zu ersetzen), damit restore-spezifische Felder wie
  // cl_fixedcrosshairgap / cl_crosshair_dynamic_* erhalten bleiben.
  const scBtn = document.getElementById('restore-sharecode-btn');
  if (scBtn) {
    scBtn.addEventListener('click', () => {
      if (!restoreDraft) return;
      openShareCodeModal({
        getParams: () => restoreDraft,
        setParams: (newParams) => {
          Object.assign(restoreDraft, newParams);
          buildEditor(document.getElementById('restore-editor'), restoreDraft, rerenderRestore);
          rerenderRestore();
        },
      });
    });
  }
}

async function saveRestore() {
  ps.data.restore = { params: restoreDraft };
  document.getElementById('restore-modal').classList.remove('open');
  await saveStateNow();
  toast('Restore crosshair saved', 'ok');
}

function openKeysModal() {
  document.getElementById('key-next').value = ps.data.keys.next || 'o';
  document.getElementById('key-restore').value = ps.data.keys.restore || 'p';
  document.getElementById('keys-modal').classList.add('open');
}

async function saveKeys() {
  const next = document.getElementById('key-next').value.trim();
  const restore = document.getElementById('key-restore').value.trim();
  ps.data.keys = { next, restore };
  document.getElementById('keys-modal').classList.remove('open');
  await saveStateNow();
  toast('Key bindings saved', 'ok');
}

// =========================================================================
// External hook for submissions tab (after approve, refresh state + select new)
// =========================================================================

export async function refreshAfterApproval(newPresetId) {
  await load();
  if (newPresetId) ps.selectedId = newPresetId;
  renderPresetList();
  renderActiveEditor();
  renderActivePreview();
  updateCounter();
}

async function load() {
  ps.data = await api.get('/api/admin/state');
  if (!ps.selectedId && ps.data.presets.length > 0) {
    ps.selectedId = ps.data.presets[0].id;
  } else if (ps.selectedId && !ps.data.presets.find((p) => p.id === ps.selectedId)) {
    ps.selectedId = ps.data.presets.length > 0 ? ps.data.presets[0].id : null;
  }
}

async function deleteAllPresets() {
  if (ps.data.presets.length === 0) {
    toast('No presets to delete', 'ok');
    return;
  }
  const ok = await confirmDialog({
    title: 'Delete ALL presets',
    message: `Permanently remove all ${ps.data.presets.length} presets? Restore crosshair and key bindings are kept. Approved Crosshairs (backups) are kept too.`,
    okLabel: 'Delete all',
  });
  if (!ok) return;
  ps.data.presets = [];
  ps.selectedId = null;
  renderPresetList();
  renderActiveEditor();
  renderActivePreview();
  updateCounter();
  await saveStateNow();
  toast('All presets deleted', 'ok');
}

export async function initPresetsTab() {
  await load();

  document.getElementById('add-preset-btn').addEventListener('click', addPreset);
  document.getElementById('edit-restore-btn').addEventListener('click', openRestoreModal);
  document.getElementById('edit-keys-btn').addEventListener('click', openKeysModal);
  document.getElementById('export-btn').addEventListener('click', exportCfg);
  document.getElementById('delete-all-btn').addEventListener('click', deleteAllPresets);
  document.getElementById('save-restore-btn').addEventListener('click', saveRestore);
  document.getElementById('save-keys-btn').addEventListener('click', saveKeys);
  document.getElementById('sharecode-btn').addEventListener('click', () => {
    const preset = selectedPreset();
    if (!preset) {
      toast('Select or add a preset first', 'err');
      return;
    }
    openShareCodeModal({
      getParams: () => preset.params,
      setParams: (newParams) => {
        preset.params = { ...preset.params, ...newParams };
        renderActiveEditor();
        renderActivePreview();
        renderPresetList();
        autosaveLater();
      },
    });
  });

  document.getElementById('import-cfg-btn').addEventListener('click', () => {
    openCfgImportModal({
      getState: () => ps.data,
      applyImport: async ({ mode, parsed, replaceRestore, replaceKeys }) => {
        const newPresets = parsed.presets.map((p) => ({
          id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: p.name,
          params: p.params,
          ...(p.submittedBy ? { submittedBy: p.submittedBy } : {}),
        }));
        if (mode === 'replace') {
          ps.data.presets = newPresets;
        } else {
          ps.data.presets = [...ps.data.presets, ...newPresets];
        }
        if (replaceRestore && parsed.restore) ps.data.restore = parsed.restore;
        if (replaceKeys && parsed.keys)       ps.data.keys = parsed.keys;
        ps.selectedId = newPresets.length > 0 ? newPresets[0].id : ps.selectedId;
        renderPresetList();
        renderActiveEditor();
        renderActivePreview();
        updateCounter();
        await saveStateNow();
        toast(`Imported ${newPresets.length} preset${newPresets.length === 1 ? '' : 's'}`, 'ok');
      },
    });
  });

  // Preview controls: background + resolution + zoom
  const previewEl = document.getElementById('admin-preview');
  const bgSelect = buildBgSelector([previewEl]);
  bgSelect.id = 'admin-bg-select';
  const bgWrap = document.createElement('span');
  bgWrap.style.display = 'inline-flex';
  bgWrap.style.alignItems = 'center';
  bgWrap.style.gap = '6px';
  const bgLabel = document.createElement('label');
  bgLabel.className = 'muted';
  bgLabel.style.margin = '0';
  bgLabel.textContent = 'Background';
  bgWrap.appendChild(bgLabel);
  bgWrap.appendChild(bgSelect);

  const controls = buildPreviewControls(bgWrap);
  const ctlHost = document.getElementById('admin-preview-controls-host');
  if (ctlHost) ctlHost.appendChild(controls);

  // Live re-render when zoom/resolution changes
  if (!activePreviewSvg) activePreviewSvg = ensureSvg(previewEl);
  registerForRerender(activePreviewSvg, () => {
    const sel = selectedPreset();
    return sel ? sel.params : null;
  });

  // Restore-Modal: gleiche Preview-Controls (Background + Zoom) + Sharecode-Import
  setupRestoreModalControls();

  bindNameInput();
  renderPresetList();
  renderActiveEditor();
  renderActivePreview();
  updateCounter();
}
