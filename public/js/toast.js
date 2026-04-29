let host;

function ensureHost() {
  if (host && document.body.contains(host)) return host;
  host = document.createElement('div');
  host.className = 'toast-host';
  document.body.appendChild(host);
  return host;
}

export function toast(message, kind = 'ok', timeoutMs = 3000) {
  const h = ensureHost();
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = message;
  h.appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .25s';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 250);
  }, timeoutMs);
}
