import { buildEditor, clone } from './editor.js';
import { renderCrosshair, ensureSvg, registerForRerender } from './preview.js';
import { api } from './api.js';
import { toast } from './toast.js';
import { confirmDialog } from './confirm.js';
import { buildBgSelector } from './bg.js';
import { buildPreviewControls } from './preview-settings.js';

const ss = {
  filter: 'pending',
  list: [],
  editing: null,
  draft: null,
};

let onApproved;

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

async function refreshList() {
  const data = await api.get(`/api/admin/submissions?status=${encodeURIComponent(ss.filter)}`);
  ss.list = data.submissions;
  renderList();
  await refreshPendingCount();
}

async function refreshPendingCount() {
  try {
    const all = await api.get('/api/admin/submissions?status=pending');
    const count = all.submissions.length;
    const badge = document.getElementById('pending-count');
    if (count > 0) {
      badge.style.display = '';
      badge.textContent = String(count);
    } else {
      badge.style.display = 'none';
    }
  } catch (_e) { /* ignore */ }
}

function renderList() {
  const host = document.getElementById('submissions-host');
  host.innerHTML = '';
  if (ss.list.length === 0) {
    const e = document.createElement('div');
    e.className = 'empty-state card';
    e.textContent = ss.filter === 'pending'
      ? 'No pending submissions.'
      : 'Nothing to show with this filter.';
    host.appendChild(e);
    return;
  }
  const wrap = document.createElement('div');
  wrap.className = 'sub-list';
  for (const sub of ss.list) {
    wrap.appendChild(renderSubRow(sub));
  }
  host.appendChild(wrap);
}

function renderSubRow(sub) {
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
    <div class="name">
      ${escapeHtml(sub.presetName)}
      <span class="sub-status ${sub.status}">${sub.status}</span>
    </div>
    <div class="sub">by ${escapeHtml(sub.submitterName)}</div>
    <div class="date">${relativeTime(sub.submittedAt)}</div>
  `;
  row.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'sub-actions';
  actions.appendChild(actionBtn('View / Edit', '', () => openSubModal(sub)));
  if (sub.status === 'pending') {
    actions.appendChild(actionBtn('Approve & Add', 'btn-primary', () => approve(sub.id)));
    actions.appendChild(actionBtn('Reject', '', () => reject(sub.id)));
  }
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

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

let subPreviewSvg;
let subControlsReady = false;

// Einmaliges Setup: Background- + Zoom-Selector ueber dem Review-Preview.
// Listeners persistieren ueber Modal-Open/Close — der registrierte Rerender
// liefert ss.draft (oder null falls Modal zu) zurueck.
function setupSubModalControls() {
  if (subControlsReady) return;
  const previewEl = document.getElementById('sub-preview');
  if (!previewEl) return;
  if (!subPreviewSvg) subPreviewSvg = ensureSvg(previewEl);

  const bgSelect = buildBgSelector([previewEl]);
  bgSelect.id = 'sub-bg-select';
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
  const ctlHost = document.getElementById('sub-preview-controls-host');
  if (ctlHost) ctlHost.appendChild(controls);

  registerForRerender(subPreviewSvg, () => ss.draft || null);
  subControlsReady = true;
}

function openSubModal(sub) {
  ss.editing = sub;
  ss.draft = clone(sub.params);
  document.getElementById('sub-modal-by').textContent = sub.submitterName;
  document.getElementById('sub-modal-info').textContent =
    `Status: ${sub.status} • Submitted ${relativeTime(sub.submittedAt)}`;
  document.getElementById('sub-name').value = sub.presetName;
  if (!subPreviewSvg) subPreviewSvg = ensureSvg(document.getElementById('sub-preview'));
  renderCrosshair(subPreviewSvg, ss.draft);
  buildEditor(document.getElementById('sub-editor'), ss.draft, () => {
    renderCrosshair(subPreviewSvg, ss.draft);
  });
  document.getElementById('submission-modal').classList.add('open');
}

function closeSubModal() {
  document.getElementById('submission-modal').classList.remove('open');
  ss.editing = null;
  ss.draft = null;
}

async function saveSubChanges() {
  if (!ss.editing) return;
  const presetName = document.getElementById('sub-name').value.trim();
  try {
    await api.put(`/api/admin/submissions/${ss.editing.id}`, {
      presetName,
      params: ss.draft,
    });
    toast('Submission updated', 'ok');
    closeSubModal();
    await refreshList();
  } catch (err) {
    toast(`Save failed: ${err.message}`, 'err');
  }
}

async function approveFromModal() {
  if (!ss.editing) return;
  const presetName = document.getElementById('sub-name').value.trim();
  try {
    const res = await api.post(`/api/admin/submissions/${ss.editing.id}/approve`, {
      presetName,
      params: ss.draft,
    });
    toast(`Approved "${presetName}" — added to presets`, 'ok');
    closeSubModal();
    await refreshList();
    if (onApproved) await onApproved(res.preset && res.preset.id);
    // switch to presets tab
    document.querySelector('.tab[data-tab="presets"]').click();
  } catch (err) {
    toast(`Approve failed: ${err.message}`, 'err');
  }
}

async function approve(id) {
  try {
    const res = await api.post(`/api/admin/submissions/${id}/approve`);
    toast('Submission approved', 'ok');
    await refreshList();
    if (onApproved) await onApproved(res.preset && res.preset.id);
    document.querySelector('.tab[data-tab="presets"]').click();
  } catch (err) {
    toast(`Approve failed: ${err.message}`, 'err');
  }
}

async function reject(id) {
  try {
    await api.post(`/api/admin/submissions/${id}/reject`);
    toast('Submission rejected', 'ok');
    await refreshList();
  } catch (err) {
    toast(`Reject failed: ${err.message}`, 'err');
  }
}

async function del(id) {
  const ok = await confirmDialog({
    title: 'Delete submission',
    message: 'Delete this submission permanently?',
    okLabel: 'Delete',
  });
  if (!ok) return;
  try {
    await api.del(`/api/admin/submissions/${id}`);
    toast('Submission deleted', 'ok');
    await refreshList();
  } catch (err) {
    toast(`Delete failed: ${err.message}`, 'err');
  }
}

async function cleanup() {
  const ok = await confirmDialog({
    title: 'Clear non-pending submissions',
    message: 'This removes all approved and rejected submissions (also from your backups). Pending submissions are kept.',
    okLabel: 'Clear',
  });
  if (!ok) return;
  try {
    await api.post('/api/admin/submissions/cleanup');
    toast('Cleared non-pending submissions', 'ok');
    await refreshList();
  } catch (err) {
    toast(`Cleanup failed: ${err.message}`, 'err');
  }
}

export async function initSubmissionsTab(opts = {}) {
  onApproved = opts.onApproved;

  document.getElementById('status-filter').addEventListener('change', async (e) => {
    ss.filter = e.target.value;
    await refreshList();
  });
  document.getElementById('cleanup-btn').addEventListener('click', cleanup);
  document.getElementById('save-sub-btn').addEventListener('click', saveSubChanges);
  document.getElementById('approve-sub-btn').addEventListener('click', approveFromModal);

  setupSubModalControls();

  await refreshList();
}

export { refreshPendingCount };
