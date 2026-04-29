// In-app confirm dialog. Replaces window.confirm() because some browsers
// silently block confirm() after repeated use. Returns a Promise<boolean>.

function htmlToFragment(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}

const HTML = `
<div class="modal-backdrop">
  <div class="modal modal-sm">
    <div class="modal-header">
      <h3 data-role="title">Confirm</h3>
    </div>
    <div data-role="message" style="margin-bottom: 8px; color: var(--text);"></div>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Cancel</button>
      <button class="btn btn-danger" data-act="ok">Confirm</button>
    </div>
  </div>
</div>
`;

export function confirmDialog({ title = 'Confirm', message = 'Are you sure?', okLabel = 'Confirm', cancelLabel = 'Cancel', danger = true } = {}) {
  return new Promise((resolve) => {
    const root = htmlToFragment(HTML);
    document.body.appendChild(root);
    requestAnimationFrame(() => root.classList.add('open'));

    root.querySelector('[data-role="title"]').textContent = title;
    root.querySelector('[data-role="message"]').textContent = message;
    const okBtn = root.querySelector('[data-act="ok"]');
    okBtn.textContent = okLabel;
    okBtn.classList.toggle('btn-danger', danger);
    okBtn.classList.toggle('btn-primary', !danger);
    root.querySelector('[data-act="cancel"]').textContent = cancelLabel;

    function close(result) {
      root.classList.remove('open');
      setTimeout(() => root.remove(), 0);
      resolve(result);
    }
    root.querySelector('[data-act="ok"]').addEventListener('click', () => close(true));
    root.querySelector('[data-act="cancel"]').addEventListener('click', () => close(false));
    root.addEventListener('click', (e) => { if (e.target === root) close(false); });
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); close(false); }
      if (e.key === 'Enter')  { document.removeEventListener('keydown', onKey); close(true); }
    });

    setTimeout(() => okBtn.focus(), 50);
  });
}
