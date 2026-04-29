// Approved Crosshairs tab — listet alle approved Submissions als Backups.
// Admin kann sie zurueck in die aktiven Presets laden oder dauerhaft loeschen.

import { renderCrosshair, ensureSvg } from './preview.js';
import { api } from './api.js';
import { toast } from './toast.js';
import { confirmDialog } from './confirm.js';

const as = {
  list: [],
};

let onLoadedToPresets;

function relativeTime(iso) {
  const t = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} d ago`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

async function loadList() {
  try {
    const res = await api.get('/api/admin/submissions?status=approved');
    as.list = (res && res.submissions) || [];
  } catch (_e) {
    as.list = [];
  }
}

function updateBadge() {
  const badge = document.getElementById('backup-count');
  if (!badge) return;
  if (as.list.length > 0) {
    badge.style.display = '';
    badge.textContent = String(as.list.length);
  } else {
    badge.style.display = 'none';
  }
}

function renderList() {
  const host = document.getElementById('approved-host');
  if (!host) return;
  host.innerHTML = '';
  updateBadge();

  if (as.list.length === 0) {
    const e = document.createElement('div');
    e.className = 'empty-state card';
    e.textContent = 'No approved crosshairs yet. When you approve a submission it will appear here as a backup.';
    host.appendChild(e);
    return;
  }
  // Newest first
  const sorted = [...as.list].sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));
  const wrap = document.createElement('div');
  wrap.className = 'sub-list';
  for (const sub of sorted) {
    wrap.appendChild(renderRow(sub));
  }
  host.appendChild(wrap);
}

function renderRow(sub) {
  const row = document.createElement('div');
  row.className = 'sub-row';

  const mini = document.createElement('div');
  mini.className = 'preview-mini';
  const svg = ensureSvg(mini);
  renderCrosshair(svg, sub.params);
  row.appendChild(mini);

  const meta = document.createElement('div');
  meta.className = 'sub-meta';
  meta.innerHTML = `
    <div class="name">${escapeHtml(sub.presetName)}</div>
    <div class="sub">by ${escapeHtml(sub.submitterName)}</div>
    <div class="date">${relativeTime(sub.submittedAt)}</div>
  `;
  row.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'sub-actions';
  actions.appendChild(actionBtn('Load to Presets', 'btn-primary', () => loadToPresets(sub)));
  actions.appendChild(actionBtn('Delete', 'btn-danger', () => del(sub.id)));
  row.appendChild(actions);

  return row;
}

function actionBtn(label, klass, onClick) {
  const b = document.createElement('button');
  b.className = `btn btn-sm ${klass}`;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

async function loadToPresets(sub) {
  try {
    const cur = await api.get('/api/admin/state');
    let name = sub.presetName;
    const exists = cur.presets.some((p) => p.name === name && p.submittedBy === sub.submitterName);
    if (exists) name = `${name} (restored)`;
    const next = {
      ...cur,
      presets: [...cur.presets, {
        name,
        params: { ...sub.params },
        submittedBy: sub.submitterName,
      }],
    };
    await api.put('/api/admin/state', next);
    toast(`Loaded "${sub.presetName}" into Presets`, 'ok');
    if (onLoadedToPresets) await onLoadedToPresets();
  } catch (err) {
    toast(`Load failed: ${err.message}`, 'err');
  }
}

async function del(id) {
  const ok = await confirmDialog({
    title: 'Delete approved crosshair',
    message: 'Remove this approved crosshair from the backups list? The active preset (if any) is not affected.',
    okLabel: 'Delete',
  });
  if (!ok) return;
  try {
    await api.del(`/api/admin/submissions/${id}`);
    toast('Removed from approved backups', 'ok');
    await refreshApproved();
  } catch (err) {
    toast(`Delete failed: ${err.message}`, 'err');
  }
}

export async function refreshApproved() {
  await loadList();
  renderList();
}

export async function initApprovedTab(opts = {}) {
  onLoadedToPresets = opts.onLoadedToPresets;
  await refreshApproved();
}
