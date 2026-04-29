// Reusable share-code / console-command import/export UI helpers.

import { encode, decode } from './sharecode.js';
import { parseCommands, formatCommands } from './commands.js';
import { toast } from './toast.js';

function htmlToFragment(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}

const MODAL_HTML = `
<div class="modal-backdrop" data-role="sharecode-modal">
  <div class="modal modal-sm">
    <div class="modal-header">
      <h3>Crosshair Import / Export</h3>
      <button class="btn btn-ghost btn-icon" data-act="close" aria-label="Close">×</button>
    </div>
    <div class="tabs" style="margin-bottom:12px;">
      <button class="tab active" data-tab="import">Import</button>
      <button class="tab" data-tab="export">Export</button>
    </div>

    <div data-pane="import">
      <div class="field">
        <label>Paste a CS2 share code OR a block of console commands</label>
        <textarea data-role="sc-input" rows="6" autocomplete="off" spellcheck="false"
          placeholder="CSGO-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX
or
cl_crosshairstyle 4; cl_crosshairsize 5; cl_crosshairthickness 1; ..."
          style="width:100%; resize:vertical; font-family:monospace; font-size:12px;
                 background:var(--bg); color:var(--text); border:1px solid var(--border);
                 border-radius:var(--radius-sm); padding:8px 10px;"></textarea>
      </div>
      <div data-role="sc-msg" style="font-size:12px; min-height:16px;" class="muted"></div>
      <div class="modal-actions">
        <button class="btn" data-act="close">Cancel</button>
        <button class="btn btn-primary" data-act="apply">Apply</button>
      </div>
    </div>

    <div data-pane="export" style="display:none;">
      <div class="field">
        <label>Share code</label>
        <input type="text" data-role="sc-output" readonly />
      </div>
      <div data-role="sc-clamp-msg" style="font-size:12px; color: var(--warn); min-height:16px; margin-bottom:8px;"></div>

      <div class="field">
        <label>Console commands (paste into CS2 console)</label>
        <textarea data-role="cmd-output" rows="4" readonly
          style="width:100%; resize:vertical; font-family:monospace; font-size:12px;
                 background:var(--bg); color:var(--text); border:1px solid var(--border);
                 border-radius:var(--radius-sm); padding:8px 10px;"></textarea>
      </div>

      <div class="modal-actions">
        <button class="btn" data-act="close">Close</button>
        <button class="btn" data-act="copy-cmd">Copy commands</button>
        <button class="btn btn-primary" data-act="copy-code">Copy code</button>
      </div>
    </div>
  </div>
</div>
`;

// Detect input flavor. Returns 'sharecode' if it looks like CSGO-... format.
function looksLikeShareCode(text) {
  return /^\s*csgo[-]?[\w]{5}[-]?[\w]{5}[-]?[\w]{5}[-]?[\w]{5}[-]?[\w]{5}\s*$/i.test(text);
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_e) {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_e2) { ok = false; }
    ta.remove();
    return ok;
  }
}

// Open the modal. Caller provides:
//   getParams(): returns current params object
//   setParams(newParams): apply imported params and refresh UI
export function openShareCodeModal({ getParams, setParams }) {
  const root = htmlToFragment(MODAL_HTML);
  document.body.appendChild(root);
  root.classList.add('open');

  function close() {
    root.classList.remove('open');
    setTimeout(() => root.remove(), 0);
  }

  // Tabs
  const tabs = root.querySelectorAll('[data-tab]');
  tabs.forEach((t) => t.addEventListener('click', () => {
    tabs.forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    root.querySelector('[data-pane="import"]').style.display = t.dataset.tab === 'import' ? '' : 'none';
    root.querySelector('[data-pane="export"]').style.display = t.dataset.tab === 'export' ? '' : 'none';
    if (t.dataset.tab === 'export') refreshExport();
  }));

  // Close handlers
  root.querySelectorAll('[data-act="close"]').forEach((b) => b.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  // ----- Import -----
  const input = root.querySelector('[data-role="sc-input"]');
  const msg = root.querySelector('[data-role="sc-msg"]');

  function applyImport() {
    const raw = input.value;
    if (!raw || !raw.trim()) {
      msg.textContent = 'Enter a code or commands first.';
      msg.style.color = 'var(--err)';
      return;
    }

    let imported = null;
    let kind = '';
    if (looksLikeShareCode(raw)) {
      imported = decode(raw.trim());
      kind = 'share code';
    }
    if (!imported) {
      imported = parseCommands(raw);
      if (imported) kind = 'console commands';
    }
    // Last-ditch: try sharecode even if regex didn't match (whitespace, etc.)
    if (!imported) {
      imported = decode(raw.trim());
      if (imported) kind = 'share code';
    }

    if (!imported) {
      msg.textContent = 'Could not parse — input is neither a valid share code nor recognised commands.';
      msg.style.color = 'var(--err)';
      return;
    }

    msg.textContent = `Imported (${kind}).`;
    msg.style.color = 'var(--green)';
    setParams(imported);
    toast(`Crosshair imported from ${kind}`, 'ok');
    setTimeout(close, 200);
  }
  root.querySelector('[data-act="apply"]').addEventListener('click', applyImport);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) applyImport();
  });

  // ----- Export -----
  const output = root.querySelector('[data-role="sc-output"]');
  const clampMsg = root.querySelector('[data-role="sc-clamp-msg"]');
  const cmdOutput = root.querySelector('[data-role="cmd-output"]');

  function refreshExport() {
    const params = getParams() || {};
    const result = encode(params);
    output.value = result.code;
    if (result.clamped.length > 0) {
      const fields = result.clamped.map((c) => `${c.key} ${c.from}->${c.to}`).join(', ');
      clampMsg.textContent = `Note: share-code format has limited range — clamped: ${fields}`;
    } else {
      clampMsg.textContent = '';
    }
    cmdOutput.value = formatCommands(params);
  }

  root.querySelector('[data-act="copy-code"]').addEventListener('click', async () => {
    if (await copyToClipboard(output.value)) toast('Share code copied', 'ok');
  });
  root.querySelector('[data-act="copy-cmd"]').addEventListener('click', async () => {
    if (await copyToClipboard(cmdOutput.value)) toast('Commands copied', 'ok');
  });

  setTimeout(() => input.focus(), 50);
}
