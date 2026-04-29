import { buildEditor, DEFAULT_PARAMS, clone } from './editor.js';
import { renderCrosshair, ensureSvg, registerForRerender } from './preview.js';
import { api } from './api.js';
import { toast } from './toast.js';
import { buildBgSelector } from './bg.js';
import { openShareCodeModal } from './sharecode-ui.js';
import { buildPreviewControls } from './preview-settings.js';

const state = {
  params: clone(DEFAULT_PARAMS),
  config: { turnstileSiteKey: null, captchaEnabled: false },
  turnstileWidgetId: null,
  submitting: false,
};

const previewSvg = ensureSvg(document.getElementById('preview'));

function rerender() {
  renderCrosshair(previewSvg, state.params);
}

function rebuildEditor() {
  const host = document.getElementById('editor');
  buildEditor(host, state.params, rerender);
}

async function loadConfig() {
  try {
    state.config = await api.get('/api/public/config');
  } catch (_err) {
    state.config = { turnstileSiteKey: null, captchaEnabled: false };
  }
  if (state.config.turnstileSiteKey) {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=ccgOnTurnstileLoad';
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  }
}

async function loadDefaults() {
  try {
    const def = await api.get('/api/public/defaults');
    if (def && def.params) {
      state.params = { ...clone(DEFAULT_PARAMS), ...def.params };
    }
  } catch (_err) {
    // ignore — keep client defaults
  }
}

window.ccgOnTurnstileLoad = function () {
  const host = document.getElementById('turnstile-host');
  if (!host || !state.config.turnstileSiteKey) return;
  if (!window.turnstile) return;
  state.turnstileWidgetId = window.turnstile.render(host, {
    sitekey: state.config.turnstileSiteKey,
    theme: 'dark',
    callback: () => {
      updateSubmitState();
    },
    'expired-callback': () => updateSubmitState(),
    'error-callback': () => updateSubmitState(),
  });
};

function getTurnstileToken() {
  if (!state.config.captchaEnabled) return ''; // captcha disabled, server will skip
  if (!window.turnstile || state.turnstileWidgetId === null) return null;
  return window.turnstile.getResponse(state.turnstileWidgetId) || null;
}

function resetTurnstile() {
  if (window.turnstile && state.turnstileWidgetId !== null) {
    window.turnstile.reset(state.turnstileWidgetId);
  }
}

function openSubmitModal() {
  document.getElementById('submit-modal').classList.add('open');
  document.getElementById('submitter-name').focus();
  updateSubmitState();
}

function closeSubmitModal() {
  document.getElementById('submit-modal').classList.remove('open');
}

function updateSubmitState() {
  const submitter = document.getElementById('submitter-name').value.trim();
  const preset = document.getElementById('preset-name').value.trim();
  const namesOk = submitter.length >= 2 && preset.length >= 2;
  const tokenOk = !state.config.captchaEnabled || Boolean(getTurnstileToken());
  document.getElementById('submit-btn').disabled = state.submitting || !(namesOk && tokenOk);
}

async function submitForm() {
  if (state.submitting) return;
  state.submitting = true;
  updateSubmitState();

  const submitterName = document.getElementById('submitter-name').value.trim();
  const presetName = document.getElementById('preset-name').value.trim();
  const cfTurnstileToken = state.config.captchaEnabled ? getTurnstileToken() : '';

  try {
    await api.post('/api/submissions', {
      submitterName,
      presetName,
      params: state.params,
      cfTurnstileToken,
    });
    showThankYou(submitterName);
  } catch (err) {
    state.submitting = false;
    resetTurnstile();
    updateSubmitState();
    if (err && err.data && err.data.error === 'captcha_failed') {
      toast('Captcha-Prüfung fehlgeschlagen. Bitte erneut versuchen.', 'err');
    } else if (err && err.data && err.data.error === 'captcha_unavailable') {
      toast('Captcha-Service nicht erreichbar. Später erneut versuchen.', 'err');
    } else if (err && err.status === 429) {
      toast('Zu viele Versuche. Bitte warte etwas und versuche es erneut.', 'err');
    } else {
      toast('Submission fehlgeschlagen. Eingaben prüfen.', 'err');
    }
  }
}

function showThankYou(name) {
  closeSubmitModal();
  const overlay = document.getElementById('thanks-overlay');
  document.getElementById('thanks-name').textContent = name;
  overlay.classList.add('open');
  state.submitting = false;
}

function resetForAnother() {
  document.getElementById('thanks-overlay').classList.remove('open');
  document.getElementById('submitter-name').value = '';
  document.getElementById('preset-name').value = '';
  state.params = { ...clone(DEFAULT_PARAMS) };
  rebuildEditor();
  rerender();
  resetTurnstile();
}

function bindEvents() {
  document.getElementById('open-submit').addEventListener('click', openSubmitModal);
  document.getElementById('cancel-submit').addEventListener('click', () => {
    closeSubmitModal();
    resetTurnstile();
  });
  document.getElementById('submit-btn').addEventListener('click', submitForm);
  document.getElementById('submitter-name').addEventListener('input', updateSubmitState);
  document.getElementById('preset-name').addEventListener('input', updateSubmitState);
  document.getElementById('thanks-another').addEventListener('click', resetForAnother);

  document.getElementById('open-sharecode').addEventListener('click', () => {
    openShareCodeModal({
      getParams: () => state.params,
      setParams: (newParams) => {
        // Merge to keep keys we don't decode (e.g. cl_crosshair_dynamic_splitdist may stay null)
        state.params = { ...clone(DEFAULT_PARAMS), ...state.params, ...newParams };
        rebuildEditor();
        rerender();
      },
    });
  });

  // Close modal on backdrop click
  document.getElementById('submit-modal').addEventListener('click', (e) => {
    if (e.target.id === 'submit-modal') {
      closeSubmitModal();
      resetTurnstile();
    }
  });
}

async function init() {
  const previewEl = document.getElementById('preview');
  const bgSelect = buildBgSelector([previewEl]);
  bgSelect.id = 'bg-select';

  // Build a single controls bar: background select + resolution + zoom
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
  document.getElementById('preview-controls-host').appendChild(controls);

  // Re-render preview when zoom/resolution changes
  registerForRerender(previewSvg, () => state.params);

  rebuildEditor();
  rerender();
  bindEvents();
  await loadDefaults();
  rebuildEditor();
  rerender();
  await loadConfig();
}

init();
