import { initPresetsTab, refreshAfterApproval } from './admin-presets.js';
import { initSubmissionsTab, refreshPendingCount } from './admin-submissions.js';
import { initApprovedTab, refreshApproved } from './admin-approved.js';
import { api } from './api.js';

const TAB_IDS = ['presets', 'submissions', 'approved'];

function bindTabs() {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach((t) => {
    t.addEventListener('click', () => {
      tabs.forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      const target = t.dataset.tab;
      for (const id of TAB_IDS) {
        const pane = document.getElementById(`tab-${id}`);
        if (pane) pane.style.display = target === id ? '' : 'none';
      }
    });
  });
}

function bindModalClose() {
  document.querySelectorAll('[data-close]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-close');
      document.getElementById(id).classList.remove('open');
    });
  });
  document.querySelectorAll('.modal-backdrop').forEach((bd) => {
    bd.addEventListener('click', (e) => {
      if (e.target === bd) bd.classList.remove('open');
    });
  });
}

function bindLogout() {
  document.getElementById('logout-btn').addEventListener('click', async () => {
    try {
      await api.post('/admin/logout');
    } catch (_e) { /* ignore */ }
    location.href = '/admin/login';
  });
}

async function init() {
  bindTabs();
  bindModalClose();
  bindLogout();
  await initPresetsTab();
  await initSubmissionsTab({
    onApproved: async (newPresetId) => {
      await refreshAfterApproval(newPresetId);
      await refreshApproved();
    },
  });
  await initApprovedTab({
    onLoadedToPresets: async () => {
      await refreshAfterApproval();
    },
  });
  await refreshPendingCount();
}

init();
