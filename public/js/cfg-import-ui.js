// Modal for importing an existing cc.cfg back into the app.
// Shows a parsed preview of presets / restore / keys with a choice to
// replace the current state or append to it.

import { parseCfg } from './cfg-parse.js';
import { renderCrosshair, ensureSvg } from './preview.js';
import { toast } from './toast.js';

function htmlToFragment(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

const HTML = `
<div class="modal-backdrop">
  <div class="modal">
    <div class="modal-header">
      <h3>Import existing cc.cfg</h3>
      <button class="btn btn-ghost btn-icon" data-act="close" aria-label="Close">×</button>
    </div>

    <div class="field">
      <label>Pick a .cfg file or paste the contents below</label>
      <input type="file" data-role="file" accept=".cfg,text/plain" style="margin-bottom: 8px;" />
      <textarea data-role="text" rows="6" placeholder="// =====&#10;// CURSED CROSSHAIR CONFIG&#10;alias _c1 ..." spellcheck="false"
        style="width:100%; resize:vertical; font-family:monospace; font-size:11px;
               background:var(--bg); color:var(--text); border:1px solid var(--border);
               border-radius:var(--radius-sm); padding:8px 10px;"></textarea>
    </div>

    <div class="flex-row mb-1" style="gap:8px;">
      <button class="btn" data-act="parse">Parse</button>
      <span data-role="parse-msg" class="muted" style="font-size:12px;"></span>
    </div>

    <div data-role="preview-section" style="display:none;">
      <h4 style="margin-top:8px;">Preview</h4>
      <div data-role="preview-list" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap:8px; margin-bottom:8px;"></div>
      <div data-role="meta" class="muted" style="font-size:12px; margin-bottom: 8px;"></div>

      <div class="flex-row" style="gap:8px; margin-bottom:8px;">
        <label style="display:inline-flex; align-items:center; gap:6px; margin:0;">
          <input type="checkbox" data-role="opt-restore" checked /> Replace restore (green) crosshair
        </label>
        <label style="display:inline-flex; align-items:center; gap:6px; margin:0;">
          <input type="checkbox" data-role="opt-keys" checked /> Replace key bindings
        </label>
      </div>
    </div>

    <div class="modal-actions">
      <button class="btn" data-act="close">Cancel</button>
      <button class="btn" data-act="append" disabled>Append presets</button>
      <button class="btn btn-primary" data-act="replace" disabled>Replace all presets</button>
    </div>
  </div>
</div>
`;

// Open the modal. Caller provides:
//   getState():            current state object { presets, restore, keys }
//   applyImport(opts):     called with { mode: 'replace'|'append', parsed, replaceRestore, replaceKeys }
export function openCfgImportModal({ getState, applyImport }) {
  const root = htmlToFragment(HTML);
  document.body.appendChild(root);
  requestAnimationFrame(() => root.classList.add('open'));

  let parsed = null;

  const close = () => {
    root.classList.remove('open');
    setTimeout(() => root.remove(), 0);
  };
  root.querySelectorAll('[data-act="close"]').forEach((b) => b.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  const fileInput = root.querySelector('[data-role="file"]');
  const textArea = root.querySelector('[data-role="text"]');
  const parseMsg = root.querySelector('[data-role="parse-msg"]');
  const previewSection = root.querySelector('[data-role="preview-section"]');
  const previewList = root.querySelector('[data-role="preview-list"]');
  const metaEl = root.querySelector('[data-role="meta"]');
  const optRestore = root.querySelector('[data-role="opt-restore"]');
  const optKeys = root.querySelector('[data-role="opt-keys"]');
  const btnAppend = root.querySelector('[data-act="append"]');
  const btnReplace = root.querySelector('[data-act="replace"]');

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      textArea.value = String(reader.result || '');
      doParse();
    };
    reader.onerror = () => {
      parseMsg.textContent = 'Could not read file.';
      parseMsg.style.color = 'var(--err)';
    };
    reader.readAsText(file);
  });

  function doParse() {
    parsed = parseCfg(textArea.value);
    if (!parsed) {
      previewSection.style.display = 'none';
      btnAppend.disabled = true;
      btnReplace.disabled = true;
      parseMsg.textContent = 'No valid `_cN` alias groups found in this cfg.';
      parseMsg.style.color = 'var(--err)';
      return;
    }
    parseMsg.textContent = `Found ${parsed.presets.length} preset${parsed.presets.length === 1 ? '' : 's'}.`;
    parseMsg.style.color = 'var(--green)';
    previewSection.style.display = '';
    btnAppend.disabled = false;
    btnReplace.disabled = false;
    optRestore.disabled = !parsed.restore;
    optKeys.disabled = !parsed.keys;
    if (!parsed.restore) optRestore.checked = false;
    if (!parsed.keys)    optKeys.checked = false;

    // Render preview tiles
    previewList.innerHTML = '';
    for (const preset of parsed.presets) {
      const tile = document.createElement('div');
      tile.style.cssText = 'background:var(--bg-elev-2); border:1px solid var(--border); border-radius:var(--radius-sm); padding:8px;';
      const mini = document.createElement('div');
      mini.className = 'preview-mini';
      mini.style.width = '100%';
      mini.style.aspectRatio = '1 / 1';
      mini.style.height = 'auto';
      const svg = ensureSvg(mini);
      renderCrosshair(svg, preset.params);
      tile.appendChild(mini);
      const label = document.createElement('div');
      label.style.cssText = 'font-size: 12px; margin-top: 6px; word-break: break-word;';
      label.textContent = preset.name + (preset.submittedBy ? ` (by ${preset.submittedBy})` : '');
      tile.appendChild(label);
      previewList.appendChild(tile);
    }

    const meta = [];
    if (parsed.restore) meta.push('Restore crosshair: parsed');
    if (parsed.keys)    meta.push(`Keys: next=${parsed.keys.next}, restore=${parsed.keys.restore}`);
    metaEl.textContent = meta.join(' · ');
  }

  root.querySelector('[data-act="parse"]').addEventListener('click', doParse);
  textArea.addEventListener('blur', doParse);

  btnAppend.addEventListener('click', async () => {
    if (!parsed) return;
    await applyImport({
      mode: 'append',
      parsed,
      replaceRestore: optRestore.checked && Boolean(parsed.restore),
      replaceKeys: optKeys.checked && Boolean(parsed.keys),
    });
    close();
  });
  btnReplace.addEventListener('click', async () => {
    if (!parsed) return;
    await applyImport({
      mode: 'replace',
      parsed,
      replaceRestore: optRestore.checked && Boolean(parsed.restore),
      replaceKeys: optKeys.checked && Boolean(parsed.keys),
    });
    close();
  });
}
